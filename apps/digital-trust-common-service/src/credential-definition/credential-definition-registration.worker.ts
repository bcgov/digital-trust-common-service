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
import type { QueryRunner } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { isAdvisoryLockAcquired } from '../common/postgres-advisory-lock';
import { RegistrationBackendError } from '../common/registration-backend-error';
import { JobsService } from '../jobs/jobs.service';
import { RegistrationProblemDetailsDto } from '../operation/dto/registration-problem-details.dto';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import { CredentialDefinition } from './credential-definition.entity';
import type { DefinitionRegistration } from './credential-definition.entity';

interface RegistrationAttempt {
  tenantId: string;
  id: string;
  definition: CredentialDefinition;
  progress: DefinitionRegistration;
  operationId: string;
  runner: QueryRunner;
}

interface RegistrationWork extends RegistrationAttempt {
  operation: Operation;
  save: () => Promise<void>;
}

interface RegistrationBackend {
  port: DefinitionRegistrationPort;
  context: ConnectorContext;
}

interface RegistrationFailure {
  permanent: boolean;
  status?: number;
  problem: RegistrationProblemDetailsDto;
}

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
      locked = isAdvisoryLockAcquired(lock);
      if (!locked) {
        return;
      }
      const definition = await runner.manager.findOne(CredentialDefinition, {
        where: { id, tenantId, registrationState: 'pending' },
      });
      const progress = definition?.registration;
      const operationId = definition?.registrationOperationId;
      if (!definition || !progress || !operationId) {
        return;
      }
      await this.processRegistration({
        tenantId,
        id,
        definition,
        progress,
        operationId,
        runner,
      });
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

  private async processRegistration(
    attempt: RegistrationAttempt,
  ): Promise<void> {
    const { tenantId, id, operationId, progress, runner } = attempt;
    const operation = await runner.manager.findOne(Operation, {
      where: { id: operationId, tenantId },
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
    const work: RegistrationWork = {
      ...attempt,
      operation,
      save: async () => {
        await this.updateDefinition(attempt);
      },
    };
    progress.stage = 'preflight';
    try {
      await this.advanceRegistration(work);
      await this.persistProgress(work);
    } catch (error) {
      await this.persistFailure(error, work);
    }
  }

  private async advanceRegistration(work: RegistrationWork): Promise<void> {
    const { definition, operationId, tenantId, runner, progress } = work;
    if (!definition.isActive) {
      throw new ValidationError(['Definition was deactivated']);
    }
    const startedAt = progress.recovery
      ? new Date(progress.recovery.requestedAt)
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
    if (!definition.connectorId || !resolved.adapter.definitionRegistration) {
      throw new ValidationError(['Registration connector is unavailable']);
    }
    await this.operations.transitionState(
      operationId,
      OperationState.PROCESSING,
    );
    const port = resolved.adapter.definitionRegistration;
    progress.stage = 'issuer_resolution';
    await port.resolveIssuer(resolved.context, {
      id: progress.issuerId,
    });
    const peers = await runner.manager.find(CredentialDefinition, {
      where: { tenantId, connectorId: definition.connectorId },
    });
    this.inheritPeerSubmissions(work, peers);
    const backend = {
      port,
      context: resolved.context,
    };
    await this.advance(work, backend);
  }

  private inheritPeerSubmissions(
    work: RegistrationWork,
    peers: CredentialDefinition[],
  ): void {
    const { definition, progress } = work;
    for (const peer of peers) {
      if (
        peer.id === definition.id ||
        !peer.registration ||
        peer.registration.issuerId !== progress.issuerId ||
        peer.schemaDefinition.schema_name !==
          definition.schemaDefinition.schema_name ||
        peer.schemaDefinition.schema_version !==
          definition.schemaDefinition.schema_version
      ) {
        continue;
      }
      if (peer.registration.schemaSubmitted) {
        progress.schemaSubmitted = true;
      }
      if (
        peer.registration.definitionSubmitted &&
        progress.schemaId &&
        peer.registration.schemaId === progress.schemaId &&
        peer.registration.options.tag === progress.options.tag
      ) {
        progress.definitionSubmitted = true;
      }
    }
  }

  private async persistProgress(work: RegistrationWork): Promise<void> {
    const { definition, operation, progress } = work;
    const ready = definition.registrationState === 'ready';
    const unknownSubmission =
      (progress.schemaSubmitted &&
        !progress.schemaId &&
        !progress.schemaPendingId &&
        !progress.schemaJobId) ||
      (progress.definitionSubmitted &&
        !definition.externalId &&
        !progress.definitionPendingId &&
        !progress.definitionJobId);
    await this.persistOutcome(
      work,
      ready ? OperationState.COMPLETED : OperationState.PROCESSING,
      ready || !unknownSubmission
        ? null
        : (operation.result?.problem_details ?? null),
    );
  }

  private async persistFailure(
    error: unknown,
    work: RegistrationWork,
  ): Promise<void> {
    const { definition, progress, runner, id } = work;
    if (runner.isTransactionActive) {
      await runner.rollbackTransaction();
    }
    if (error instanceof RegistrationBackendError && error.correlation) {
      const correlation = error.correlation;
      if (correlation.artifact === 'schema') {
        progress.schemaPendingId = correlation.id;
        progress.schemaJobId = correlation.jobId;
        progress.schemaTransactionId = correlation.transactionId;
        progress.schemaState = correlation.state;
      } else {
        progress.definitionPendingId = correlation.id;
        progress.definitionJobId = correlation.jobId;
        progress.definitionTransactionId = correlation.transactionId;
        progress.definitionState = correlation.state;
      }
    }
    const failure = this.classifyFailure(error, progress.stage ?? 'preflight');
    this.logger.warn({
      message: `Registration ${id} could not advance`,
      stage: failure.problem.stage,
      backend_status: failure.status,
      retryable: failure.problem.retryable,
    });
    definition.registrationState = failure.permanent ? 'failed' : 'pending';
    await this.persistOutcome(
      work,
      failure.permanent ? OperationState.FAILED : OperationState.PROCESSING,
      failure.problem,
      failure.permanent
        ? { code: 'REGISTRATION_FAILED', message: failure.problem.detail }
        : undefined,
    );
    if (!failure.permanent) {
      throw new Error(
        'Artifact registration could not advance; retry reconciliation',
      );
    }
  }

  private classifyFailure(error: unknown, stage: string): RegistrationFailure {
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
      stage,
      retryable: !permanent,
      ...(status !== undefined ? { backend_status: status } : {}),
      ...(error instanceof RegistrationBackendError && error.backendCode
        ? { backend_code: error.backendCode }
        : {}),
    });
    return { permanent, status, problem };
  }

  private async persistOutcome(
    work: RegistrationWork,
    operationState: OperationState,
    problemDetails: unknown,
    failure?: { code: string; message: string },
  ): Promise<void> {
    const { definition, operationId, runner } = work;
    await runner.startTransaction();
    await this.updateDefinition(work);
    await this.operations.transitionState(
      operationId,
      operationState,
      {
        credential_definition_id: definition.id,
        external_id: definition.externalId,
        registration: this.progressResult(work),
        ...(failure ? { code: failure.code, message: failure.message } : {}),
        problem_details: problemDetails,
      },
      runner.manager,
    );
    await runner.commitTransaction();
  }

  private async updateDefinition(work: RegistrationAttempt): Promise<void> {
    const { id, tenantId, definition, progress, runner } = work;
    await runner.manager.update(
      CredentialDefinition,
      { id, tenantId },
      {
        registrationState: definition.registrationState,
        registration: progress,
        externalId: definition.externalId,
      },
    );
  }

  private async advance(
    work: RegistrationWork,
    backend: RegistrationBackend,
  ): Promise<void> {
    const { progress } = work;
    if (progress.recovery?.schemaTransactionId) {
      await this.observeSubmission(work, backend, 'schema');
    }
    const schemaId = await this.resolveSchema(work, backend);
    if (!schemaId) {
      return;
    }
    progress.stage = 'schema_resolution';
    await backend.port.resolveSchema(backend.context, schemaId);
    await this.advanceDefinition(work, schemaId, backend);
  }

  private async resolveSchema(
    work: RegistrationWork,
    backend: RegistrationBackend,
  ): Promise<string | null> {
    const { definition, progress } = work;
    if (progress.schemaId) {
      return progress.schemaId;
    }
    progress.stage = 'schema_lookup';
    const found = await backend.port.findSchema(
      backend.context,
      progress.issuerId,
      definition.schemaDefinition,
    );
    if (found) {
      progress.schemaId = found.id;
      definition.schemaDefinition = found.definition;
      return found.id;
    }
    if (
      !progress.recovery?.schemaTransactionId &&
      (progress.schemaSubmitted || progress.recovery)
    ) {
      await this.observeSubmission(work, backend, 'schema');
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
      return null;
    }
    await this.publishSchema(work, backend);
    return progress.schemaId ?? null;
  }

  private async publishSchema(
    work: RegistrationWork,
    backend: RegistrationBackend,
  ): Promise<void> {
    const { definition, progress, save } = work;
    progress.stage = 'schema_publication';
    // Commit intent BEFORE the non-idempotent write. A restart/timeout
    // must reconcile instead of blindly repeating ledger publication.
    progress.schemaSubmitted = true;
    await save();
    const submitted = await backend.port.publishSchema(
      backend.context,
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

  private async advanceDefinition(
    work: RegistrationWork,
    schemaId: string,
    backend: RegistrationBackend,
  ): Promise<void> {
    const { definition, progress } = work;
    progress.stage = 'definition_lookup';
    if (progress.recovery?.definitionTransactionId) {
      await this.observeSubmission(work, backend, 'credential_definition');
    }
    const found = await backend.port.findDefinition(
      backend.context,
      progress.issuerId,
      schemaId,
      progress.options,
    );
    if (!found) {
      if (
        !progress.recovery?.definitionTransactionId &&
        (progress.definitionSubmitted || progress.recovery)
      ) {
        await this.observeSubmission(work, backend, 'credential_definition');
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
      await this.publishDefinition(work, schemaId, backend);
      return;
    }
    definition.externalId = found;
    progress.stage = 'revocation_readiness';
    if (
      progress.options.revocation.enabled &&
      !(await backend.port.verifyRevocation(backend.context, found))
    ) {
      return;
    }
    definition.registrationState = 'ready';
    progress.stage = 'completed';
  }

  private async publishDefinition(
    work: RegistrationWork,
    schemaId: string,
    backend: RegistrationBackend,
  ): Promise<void> {
    const { definition, progress, save } = work;
    progress.stage = 'definition_publication';
    progress.definitionSubmitted = true;
    await save();
    const submitted = await backend.port.publishDefinition(
      backend.context,
      progress.issuerId,
      schemaId,
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

  private async observeSubmission(
    work: RegistrationWork,
    backend: RegistrationBackend,
    artifact: 'schema' | 'credential_definition',
  ): Promise<void> {
    const { definition, progress, save } = work;
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
    const observation = await backend.port.inspectRegistration(
      backend.context,
      {
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
      },
    );
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
    // Endorsement acknowledgement alone does not prove backend registry visibility or
    // wallet key ownership. The normal artifact reads still gate advancement.
  }

  private progressResult(work: RegistrationWork): Record<string, unknown> {
    const { definition, progress } = work;
    const stage = progress.stage ?? 'preflight';
    const artifact = stage.startsWith('schema_')
      ? 'schema'
      : stage.startsWith('definition_') || stage === 'revocation_readiness'
        ? 'credential_definition'
        : null;
    const isSchemaStage = artifact === 'schema';
    const isDefinitionStage = artifact === 'credential_definition';
    return {
      stage,
      artifact,
      schema_id: progress.schemaId ?? null,
      definition_id: definition.externalId ?? null,
      pending_id: isSchemaStage
        ? progress.schemaId
          ? null
          : (progress.schemaPendingId ?? null)
        : isDefinitionStage
          ? definition.externalId
            ? null
            : (progress.definitionPendingId ?? null)
          : null,
      job_id: isSchemaStage
        ? (progress.schemaJobId ?? null)
        : isDefinitionStage
          ? (progress.definitionJobId ?? null)
          : null,
      transaction_id: isSchemaStage
        ? (progress.schemaTransactionId ?? null)
        : isDefinitionStage
          ? (progress.definitionTransactionId ?? null)
          : null,
      transaction_state: isSchemaStage
        ? (progress.schemaTransactionState ?? null)
        : isDefinitionStage
          ? (progress.definitionTransactionState ?? null)
          : null,
      state: isSchemaStage
        ? progress.schemaId
          ? 'finished'
          : (progress.schemaState ?? null)
        : isDefinitionStage
          ? definition.registrationState === 'ready'
            ? 'finished'
            : (progress.definitionState ?? null)
          : null,
    };
  }
}
