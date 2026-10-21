import {
  CredentialFormat,
  DefinitionRegistrationPort,
  ConnectorContext,
  ValidationError,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { RegistrationBackendError } from '../common/registration-backend-error';
import { JobsService } from '../jobs/jobs.service';
import { RegistrationProblemDetailsDto } from '../operation/dto/registration-problem-details.dto';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import { CredentialDefinition } from './credential-definition.entity';

@Injectable()
export class CredentialDefinitionRegistrationWorker implements OnModuleInit {
  private readonly logger = new Logger(
    CredentialDefinitionRegistrationWorker.name,
  );

  public constructor(
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly adapters: AdapterRegistry,
    private readonly operations: OperationService,
  ) {}

  public async onModuleInit(): Promise<void> {
    const enabled =
      this.config.get<string>('PG_BOSS_WORKERS_ENABLED', 'true') !== 'false';
    await this.jobs.registerWorker<{
      tenantId?: string;
      definitionId?: string;
    }>(
      JOB_QUEUES.DEFINITION_REGISTER,
      async (job) => {
        const data = job?.data;
        if (data?.definitionId && data.tenantId) {
          await this.process(data.tenantId, data.definitionId);
        } else {
          await this.reconcile();
        }
      },
      { enabled },
    );
    if (enabled) {
      await this.jobs.schedule(JOB_QUEUES.DEFINITION_REGISTER, '* * * * *');
    }
  }

  public async reconcile(): Promise<void> {
    const pending = await this.dataSource
      .getRepository(CredentialDefinition)
      .find({
        where: { registrationState: 'pending' },
        order: { updatedAt: 'ASC' },
        take: 50,
      });
    for (const definition of pending) {
      try {
        await this.process(definition.tenantId, definition.id);
      } catch {
        this.logger.warn(
          `Registration ${definition.id} will be reconciled again`,
        );
      }
    }
  }

  public async process(tenantId: string, id: string): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let lockId = '';
    let locked = false;
    try {
      const binding = await runner.manager.findOne(CredentialDefinition, {
        where: { id, tenantId, registrationState: 'pending' },
      });
      if (!binding?.connectorId) {
        return;
      }
      // Serialize this wallet's publications, including differently named
      // local registrations sharing a schema or credential-definition tag.
      lockId = `${tenantId}:${binding.connectorId}:registration`;
      const locks: unknown = await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [lockId],
      );
      const lock: unknown = Array.isArray(locks) ? locks[0] : null;
      locked =
        typeof lock === 'object' &&
        lock !== null &&
        'locked' in lock &&
        lock.locked === true;
      if (!locked) {
        return;
      }
      const definition = await runner.manager.findOne(CredentialDefinition, {
        where: { id, tenantId, registrationState: 'pending' },
      });
      if (!definition?.registration || !definition.registrationOperationId) {
        return;
      }
      const operation = await runner.manager.findOne(Operation, {
        where: { id: definition.registrationOperationId, tenantId },
      });
      if (!operation || operation.state === OperationState.FAILED) {
        await runner.manager.update(
          CredentialDefinition,
          { id, tenantId },
          {
            registrationState: 'failed',
          },
        );
        this.logger.warn(
          `Registration ${id} has no live operation; backend reconciliation is required`,
        );
        return;
      }
      definition.registration.stage = 'preflight';
      try {
        if (!definition.isActive) {
          throw new ValidationError(['Definition was deactivated']);
        }
        const startedAt = definition.registration.recovery
          ? new Date(definition.registration.recovery.requestedAt)
          : definition.createdAt;
        if (Date.now() - startedAt.getTime() > 24 * 60 * 60 * 1000) {
          throw new ValidationError([
            'Registration timed out; reconcile backend artifacts before resubmitting',
          ]);
        }
        const resolved = await this.adapters.resolve(
          tenantId,
          CredentialFormat.AnonCreds,
          {
            connectorId: definition.connectorId ?? undefined,
          },
        );
        if (
          !definition.connectorId ||
          !resolved.adapter.definitionRegistration
        ) {
          throw new ValidationError(['Registration connector is unavailable']);
        }
        await this.operations.transitionState(
          definition.registrationOperationId,
          OperationState.PROCESSING,
        );
        const port = resolved.adapter.definitionRegistration;
        definition.registration.stage = 'issuer_resolution';
        await port.resolveIssuer(resolved.context, {
          id: definition.registration.issuerId,
        });
        const save = async (): Promise<void> => {
          await runner.manager.update(
            CredentialDefinition,
            { id, tenantId },
            {
              registration: definition.registration,
              registrationState: definition.registrationState,
              externalId: definition.externalId,
            },
          );
        };
        const peers = await runner.manager.find(CredentialDefinition, {
          where: { tenantId, connectorId: definition.connectorId },
        });
        for (const peer of peers) {
          if (
            peer.id === id ||
            !peer.registration ||
            peer.registration.issuerId !== definition.registration.issuerId ||
            peer.schemaDefinition.schema_name !==
              definition.schemaDefinition.schema_name ||
            peer.schemaDefinition.schema_version !==
              definition.schemaDefinition.schema_version
          ) {
            continue;
          }
          if (peer.registration.schemaSubmitted) {
            definition.registration.schemaSubmitted = true;
          }
          if (
            peer.registration.definitionSubmitted &&
            definition.registration.schemaId &&
            peer.registration.schemaId === definition.registration.schemaId &&
            peer.registration.options.tag ===
              definition.registration.options.tag
          ) {
            definition.registration.definitionSubmitted = true;
          }
        }
        await this.advance(definition, port, resolved.context, save);
        await runner.startTransaction();
        await save();
        if (definition.registrationState === 'ready') {
          await this.operations.transitionState(
            definition.registrationOperationId,
            OperationState.COMPLETED,
            {
              credential_definition_id: definition.id,
              external_id: definition.externalId,
              registration: this.progressResult(definition),
              problem_details: null,
            },
            runner.manager,
          );
        } else {
          const progress = definition.registration;
          const unknownSubmission =
            (progress.schemaSubmitted &&
              !progress.schemaId &&
              !progress.schemaPendingId &&
              !progress.schemaJobId) ||
            (progress.definitionSubmitted &&
              !definition.externalId &&
              !progress.definitionPendingId &&
              !progress.definitionJobId);
          await this.operations.transitionState(
            definition.registrationOperationId,
            OperationState.PROCESSING,
            {
              credential_definition_id: definition.id,
              external_id: definition.externalId,
              registration: this.progressResult(definition),
              problem_details: unknownSubmission
                ? (operation.result?.problem_details ?? null)
                : null,
            },
            runner.manager,
          );
        }
        await runner.commitTransaction();
      } catch (error) {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();
        }
        if (error instanceof RegistrationBackendError && error.correlation) {
          const correlation = error.correlation;
          if (correlation.artifact === 'schema') {
            definition.registration.schemaPendingId = correlation.id;
            definition.registration.schemaJobId = correlation.jobId;
            definition.registration.schemaTransactionId =
              correlation.transactionId;
            definition.registration.schemaState = correlation.state;
          } else {
            definition.registration.definitionPendingId = correlation.id;
            definition.registration.definitionJobId = correlation.jobId;
            definition.registration.definitionTransactionId =
              correlation.transactionId;
            definition.registration.definitionState = correlation.state;
          }
        }
        const status =
          error instanceof RegistrationBackendError
            ? error.status
            : axios.isAxiosError(error)
              ? error.response?.status
              : undefined;
        const permanent =
          error instanceof ValidationError ||
          (error instanceof RegistrationBackendError &&
            error.backendCode === 'REGISTRATION_REJECTED') ||
          (status !== undefined &&
            status >= 400 &&
            status < 500 &&
            ![404, 408, 429].includes(status));
        const problem = RegistrationProblemDetailsDto.create({
          detail:
            error instanceof RegistrationBackendError
              ? error.detail
              : error instanceof ValidationError
                ? error.issues.join('; ')
                : 'Registration could not advance; backend artifacts will be reconciled before any further publication',
          stage: definition.registration.stage ?? 'preflight',
          retryable: !permanent,
          ...(status !== undefined ? { backend_status: status } : {}),
          ...(error instanceof RegistrationBackendError && error.backendCode
            ? { backend_code: error.backendCode }
            : {}),
        });
        // Never log raw errors, headers, or backend response bodies.
        this.logger.warn({
          message: `Registration ${id} could not advance`,
          stage: problem.stage,
          backend_status: status,
          retryable: problem.retryable,
        });
        definition.registrationState = permanent ? 'failed' : 'pending';
        await runner.startTransaction();
        await runner.manager.update(
          CredentialDefinition,
          { id, tenantId },
          {
            registrationState: definition.registrationState,
            registration: definition.registration,
            externalId: definition.externalId,
          },
        );
        await this.operations.transitionState(
          definition.registrationOperationId,
          permanent ? OperationState.FAILED : OperationState.PROCESSING,
          {
            credential_definition_id: definition.id,
            external_id: definition.externalId,
            registration: this.progressResult(definition),
            ...(permanent
              ? {
                  code: 'REGISTRATION_FAILED',
                  message: problem.detail,
                }
              : {}),
            problem_details: problem,
          },
          runner.manager,
        );
        await runner.commitTransaction();
        if (!permanent) {
          throw new Error(
            'Artifact registration could not advance; retry reconciliation',
          );
        }
      }
    } finally {
      try {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();
        }
        if (locked) {
          await runner.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [lockId],
          );
        }
      } finally {
        await runner.release();
      }
    }
  }

  private async advance(
    definition: CredentialDefinition,
    port: DefinitionRegistrationPort,
    context: ConnectorContext,
    save: () => Promise<void>,
  ): Promise<void> {
    const progress = definition.registration;
    if (!progress) {
      throw new ValidationError(['Missing registration progress']);
    }
    // Verify supplied hints even when the artifact is already published.
    if (progress.recovery?.schemaTransactionId) {
      await this.observeSubmission(definition, port, context, 'schema', save);
    }
    if (!progress.schemaId) {
      progress.stage = 'schema_lookup';
      const found = await port.findSchema(
        context,
        progress.issuerId,
        definition.schemaDefinition,
      );
      if (found) {
        progress.schemaId = found.id;
        definition.schemaDefinition = found.definition;
      } else {
        if (
          !progress.recovery?.schemaTransactionId &&
          (progress.schemaSubmitted || progress.recovery)
        ) {
          await this.observeSubmission(
            definition,
            port,
            context,
            'schema',
            save,
          );
        }
        if (progress.schemaSubmitted) {
          if (
            !progress.schemaTransactionId &&
            !progress.schemaJobId &&
            !progress.schemaPendingId
          ) {
            throw new RegistrationBackendError(
              undefined,
              'REGISTRATION_OUTCOME_UNKNOWN',
              'Schema submission outcome is unknown; supply a matching endorsement transaction or reconcile the wallet and ledger. Publication will not be repeated',
            );
          }
          return;
        }
        progress.stage = 'schema_publication';
        // Commit intent BEFORE the non-idempotent write. A restart/timeout
        // must reconcile instead of blindly repeating ledger publication.
        progress.schemaSubmitted = true;
        await save();
        const submitted = await port.publishSchema(
          context,
          progress.issuerId,
          definition.schemaDefinition,
        );
        progress.schemaJobId = submitted.jobId;
        progress.schemaState = submitted.state;
        progress.schemaTransactionId = submitted.transactionId;
        if (submitted.state === 'finished') {
          progress.schemaId = submitted.id;
        } else {
          progress.schemaPendingId = submitted.id;
        }
        await save();
      }
      if (!progress.schemaId) {
        return;
      }
    }
    progress.stage = 'schema_resolution';
    await port.resolveSchema(context, progress.schemaId);
    progress.stage = 'definition_lookup';
    if (progress.recovery?.definitionTransactionId) {
      await this.observeSubmission(
        definition,
        port,
        context,
        'credential_definition',
        save,
      );
    }
    const found = await port.findDefinition(
      context,
      progress.issuerId,
      progress.schemaId,
      progress.options,
    );
    if (!found) {
      if (
        !progress.recovery?.definitionTransactionId &&
        (progress.definitionSubmitted || progress.recovery)
      ) {
        await this.observeSubmission(
          definition,
          port,
          context,
          'credential_definition',
          save,
        );
      }
      if (progress.definitionSubmitted) {
        if (
          !progress.definitionTransactionId &&
          !progress.definitionJobId &&
          !progress.definitionPendingId &&
          !definition.externalId
        ) {
          throw new RegistrationBackendError(
            undefined,
            'REGISTRATION_OUTCOME_UNKNOWN',
            'Credential definition submission outcome is unknown; reconcile the wallet and ledger before any new publication',
          );
        }
        return;
      }
      if (!progress.definitionSubmitted) {
        progress.stage = 'definition_publication';
        progress.definitionSubmitted = true;
        await save();
        const submitted = await port.publishDefinition(
          context,
          progress.issuerId,
          progress.schemaId,
          progress.options,
        );
        progress.definitionJobId = submitted.jobId;
        progress.definitionState = submitted.state;
        progress.definitionTransactionId = submitted.transactionId;
        if (submitted.state === 'finished') {
          definition.externalId = submitted.id ?? null;
        } else {
          progress.definitionPendingId = submitted.id;
        }
      }
      return;
    }
    definition.externalId = found;
    progress.stage = 'revocation_readiness';
    if (
      progress.options.revocation.enabled &&
      !(await port.verifyRevocation(context, found))
    ) {
      return;
    }
    definition.registrationState = 'ready';
    progress.stage = 'completed';
  }

  private async observeSubmission(
    definition: CredentialDefinition,
    port: DefinitionRegistrationPort,
    context: ConnectorContext,
    artifact: 'schema' | 'credential_definition',
    save: () => Promise<void>,
  ): Promise<void> {
    const progress = definition.registration;
    if (!progress) {
      throw new ValidationError(['Missing registration progress']);
    }
    progress.stage =
      artifact === 'schema'
        ? 'schema_reconciliation'
        : 'definition_reconciliation';
    const hint =
      artifact === 'schema'
        ? progress.recovery?.schemaTransactionId
        : progress.recovery?.definitionTransactionId;
    const previousTransactionId =
      artifact === 'schema'
        ? progress.schemaTransactionId
        : progress.definitionTransactionId;
    const transactionId = hint ?? previousTransactionId;
    const observation = await port.inspectRegistration(context, {
      artifact,
      issuerId: progress.issuerId,
      schema: definition.schemaDefinition,
      schemaId: progress.schemaId,
      options: progress.options,
      transactionId,
      jobId:
        hint && hint !== previousTransactionId
          ? undefined
          : artifact === 'schema'
            ? progress.schemaJobId
            : progress.definitionJobId,
    });
    if (!observation) {
      return;
    }
    const rejected = ['transaction_refused', 'transaction_cancelled'].includes(
      observation.state,
    );
    if (artifact === 'schema') {
      progress.schemaSubmitted = true;
      progress.schemaPendingId = observation.id;
      progress.schemaJobId = observation.jobId;
      progress.schemaTransactionId = observation.transactionId;
      progress.schemaTransactionState = observation.state;
      progress.schemaState = rejected ? 'failed' : 'wait';
    } else {
      progress.definitionSubmitted = true;
      progress.definitionPendingId = observation.id;
      progress.definitionJobId = observation.jobId;
      progress.definitionTransactionId = observation.transactionId;
      progress.definitionTransactionState = observation.state;
      progress.definitionState = rejected ? 'failed' : 'wait';
    }
    await save();
    if (rejected) {
      throw new ValidationError([
        `Endorsement ${observation.state}; publication remains blocked until backend state is definitively resolved`,
      ]);
    }
    if (
      ![
        'transaction_acked',
        'transaction_endorsed',
        'request_sent',
        'request_received',
        'transaction_created',
        'transaction_resent',
        'transaction_resent_received',
      ].includes(observation.state)
    ) {
      throw new RegistrationBackendError(
        undefined,
        'REGISTRATION_OUTCOME_UNKNOWN',
        'Endorsement transaction has an unrecognized state; publication will not be repeated',
      );
    }
    // Endorsement acknowledgement alone does not prove ledger visibility or
    // wallet key ownership. The normal artifact reads still gate advancement.
  }

  private progressResult(
    definition: CredentialDefinition,
  ): Record<string, unknown> {
    const progress = definition.registration;
    return {
      stage: progress?.stage ?? 'preflight',
      schema_id: progress?.schemaId ?? progress?.schemaPendingId ?? null,
      schema_job_id: progress?.schemaJobId ?? null,
      schema_transaction_id: progress?.schemaTransactionId ?? null,
      schema_transaction_state: progress?.schemaTransactionState ?? null,
      schema_state: progress?.schemaId
        ? 'finished'
        : (progress?.schemaState ?? null),
      definition_id:
        definition.externalId ?? progress?.definitionPendingId ?? null,
      definition_job_id: progress?.definitionJobId ?? null,
      definition_transaction_id: progress?.definitionTransactionId ?? null,
      definition_transaction_state:
        progress?.definitionTransactionState ?? null,
      recovery_requested_at: progress?.recovery?.requestedAt ?? null,
      recovery_attempts: progress?.recovery?.history.length ?? 0,
      recovery_history: progress?.recovery?.history ?? [],
      definition_state:
        definition.registrationState === 'ready'
          ? 'finished'
          : (progress?.definitionState ?? null),
    };
  }
}
