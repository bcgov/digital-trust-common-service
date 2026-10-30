import { createHash } from 'node:crypto';

import {
  CredentialFormat,
  AnonCredsRegistrationPort,
  ValidationError,
  type ConnectorContext,
  type RegistrationSubmission,
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

import {
  ArtifactProgress,
  CredentialDefinition,
  CredentialDefinitionFormat,
  DefinitionRegistration,
} from './credential-definition.entity';

const WAIT_INTERVAL_SECONDS = 15;
const MAX_WAIT_CHECKS = 20;

interface RegistrationJobData {
  tenantId?: string;
  definitionId?: string;
  checks?: number;
}

interface RegistrationWork {
  tenantId: string;
  definition: CredentialDefinition;
  registration: DefinitionRegistration;
  operationId: string;
  checks: number;
}

interface RegistrationBackend {
  port: AnonCredsRegistrationPort;
  context: ConnectorContext;
}

interface RegistrationFailure {
  detail: string;
  status?: number;
  code?: string;
  problem: RegistrationProblemDetailsDto;
}

@Injectable()
export class AnonCredsCredentialDefinitionRegistrationWorker implements OnModuleInit {
  private readonly logger = new Logger(
    AnonCredsCredentialDefinitionRegistrationWorker.name,
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
    await this.jobs.registerWorker<RegistrationJobData>(
      JOB_QUEUES.DEFINITION_REGISTER,
      async (job) => {
        const data = job?.data;
        if (!data?.tenantId || !data.definitionId) {
          return;
        }
        await this.process(
          data.tenantId,
          data.definitionId,
          Number.isSafeInteger(data.checks) && (data.checks ?? 0) >= 0
            ? (data.checks ?? 0)
            : 0,
        );
      },
      { enabled },
    );
  }

  public async process(
    tenantId: string,
    id: string,
    checks = 0,
  ): Promise<void> {
    const definition = await this.dataSource
      .getRepository(CredentialDefinition)
      .findOne({
        where: {
          id,
          tenantId,
          format: CredentialDefinitionFormat.ANONCREDS,
          registrationState: 'pending',
        },
      });
    if (!definition) {
      return;
    }

    const registration = definition.registration
      ? {
          ...definition.registration,
          schema: definition.registration.schema ?? {},
          definition: definition.registration.definition ?? {},
        }
      : null;
    const operationId = definition.registrationOperationId;
    if (!registration || !operationId) {
      await this.failWithoutOperation(definition, 'preflight');
      return;
    }

    const work: RegistrationWork = {
      tenantId,
      definition,
      registration,
      operationId,
      checks,
    };
    const operation = await this.dataSource
      .getRepository(Operation)
      .findOne({ where: { id: operationId, tenantId } });
    if (!operation || operation.state === OperationState.FAILED) {
      await this.failWithoutOperation(definition, 'preflight');
      return;
    }

    try {
      if (!definition.isActive || !definition.connectorId) {
        throw new ValidationError([
          'The credential definition or its connector is unavailable',
        ]);
      }
      const resolved = await this.adapters.resolve(
        tenantId,
        CredentialFormat.AnonCreds,
        { connectorId: definition.connectorId },
      );
      const port = resolved.adapter.anonCredsRegistration;
      if (!port) {
        throw new ValidationError([
          'The selected connector does not support AnonCreds registration',
        ]);
      }
      const backend = { port, context: resolved.context };
      await this.transitionOperation(work, OperationState.PROCESSING);
      const issuerId = await port.resolveIssuer(resolved.context, {
        id: registration.issuerId,
      });
      if (issuerId !== registration.issuerId) {
        throw new ValidationError(['The configured issuer no longer matches']);
      }
      await this.advance(work, backend);
    } catch (error) {
      await this.persistFailure(error, work, registration.stage ?? 'preflight');
    }
  }

  private async advance(
    work: RegistrationWork,
    backend: RegistrationBackend,
  ): Promise<void> {
    const schemaId = await this.advanceSchema(work, backend);
    if (!schemaId) {
      await this.persistWaiting(work);
      return;
    }

    const options = this.definitionOptions(work.definition);
    work.registration.stage = 'definition_lookup';
    const found = await backend.port.findDefinition(
      backend.context,
      work.registration.issuerId,
      schemaId,
      options,
    );
    if (found) {
      work.definition.externalId = found;
      work.registration.definition = {
        ...work.registration.definition,
        id: found,
        state: 'finished',
      };
      await this.saveProgress(work);
    } else if (this.hasSubmission(work.registration.definition)) {
      if (
        work.registration.definition.state === 'finished' &&
        !work.registration.definition.id
      ) {
        throw new ValidationError([
          'Completed credential-definition registration has no ID',
        ]);
      }
      work.registration.stage = 'awaiting_definition_endorsement';
      await this.persistWaiting(work);
      return;
    } else {
      work.registration.stage = 'definition_publication';
      const submitted = await this.publishArtifact(
        work,
        backend,
        'definition',
        schemaId,
      );
      if (!submitted) {
        work.registration.stage = 'awaiting_definition_discovery';
        await this.persistWaiting(work);
        return;
      }
      work.registration.definition = this.toProgress(submitted);
      if (submitted.state === 'failed') {
        await this.saveProgress(work);
        throw this.submissionFailure(submitted);
      }
      if (submitted.state !== 'finished') {
        work.registration.stage = 'awaiting_definition_endorsement';
        await this.saveProgress(work);
        await this.persistWaiting(work);
        return;
      }
      if (!submitted.id) {
        throw new RegistrationBackendError(
          undefined,
          'INVALID_REGISTRATION_RESPONSE',
          'Backend reported a completed credential definition without an ID',
        );
      }
      work.definition.externalId = submitted.id;
      await this.saveProgress(work);
    }

    if (
      options.status.revocation.enabled &&
      !(await backend.port.verifyRevocation(
        backend.context,
        work.definition.externalId,
      ))
    ) {
      work.registration.stage = 'awaiting_revocation_registry';
      await this.persistWaiting(work);
      return;
    }

    work.registration.stage = 'completed';
    work.definition.registrationState = 'ready';
    await this.persistOutcome(work, OperationState.COMPLETED);
  }

  private async advanceSchema(
    work: RegistrationWork,
    backend: RegistrationBackend,
  ): Promise<string | null> {
    const progress = work.registration.schema;
    if (progress.state === 'finished' && !progress.id) {
      throw new ValidationError([
        'Completed schema registration has no resolvable ID',
      ]);
    }
    if (progress.state === 'finished' && progress.id) {
      work.registration.stage = 'schema_resolution';
      await backend.port.resolveSchema(backend.context, progress.id);
      return progress.id;
    }

    work.registration.stage = 'schema_lookup';
    const found = await backend.port.findSchema(
      backend.context,
      work.registration.issuerId,
      work.definition.schemaDefinition,
    );
    if (found) {
      work.registration.schema = {
        ...progress,
        id: found.id,
        state: 'finished',
      };
      await this.saveProgress(work);
      return found.id;
    }
    if (this.hasSubmission(progress)) {
      work.registration.stage = 'awaiting_schema_endorsement';
      return null;
    }

    work.registration.stage = 'schema_publication';
    const submitted = await this.publishArtifact(work, backend, 'schema');
    if (!submitted) {
      work.registration.stage = 'awaiting_schema_discovery';
      return null;
    }
    work.registration.schema = this.toProgress(submitted);
    await this.saveProgress(work);
    if (submitted.state === 'failed') {
      throw this.submissionFailure(submitted);
    }
    if (submitted.state !== 'finished') {
      work.registration.stage = 'awaiting_schema_endorsement';
      return null;
    }
    if (!submitted.id) {
      throw new RegistrationBackendError(
        undefined,
        'INVALID_REGISTRATION_RESPONSE',
        'Backend reported a completed schema without an ID',
      );
    }
    return submitted.id;
  }

  private hasSubmission(progress: ArtifactProgress): boolean {
    if (progress.state === 'failed') {
      return false;
    }
    return Boolean(
      progress.id || progress.jobId || progress.transactionId || progress.state,
    );
  }

  private async publishArtifact(
    work: RegistrationWork,
    backend: RegistrationBackend,
    artifact: 'schema' | 'definition',
    schemaId?: string,
  ): Promise<RegistrationSubmission | null> {
    const connectorId = work.definition.connectorId;
    if (!connectorId) {
      throw new ValidationError(['The registration connector is unavailable']);
    }
    const options = this.definitionOptions(work.definition);
    const identity =
      artifact === 'schema'
        ? [
            artifact,
            work.registration.issuerId,
            work.definition.schemaDefinition.schema_name,
            work.definition.schemaDefinition.schema_version,
          ]
        : [artifact, work.registration.issuerId, schemaId, options.tag];
    const key = createHash('sha256')
      .update(JSON.stringify(identity))
      .digest('hex');
    const parameters = [work.tenantId, connectorId, key];
    const claimed = await this.dataSource.transaction((manager) =>
      manager.query<{ artifact_key: string }[]>(
        `
        INSERT INTO anoncreds_publication_intent
          (tenant_id, connector_id, artifact_key, state)
        VALUES ($1, $2, $3, 'publishing')
        ON CONFLICT (tenant_id, connector_id, artifact_key) DO UPDATE
          SET state = 'publishing'
          WHERE anoncreds_publication_intent.state = 'rejected'
        RETURNING artifact_key
      `,
        parameters,
      ),
    );
    if (claimed.length === 0) {
      return null;
    }

    // A missing response leaves the committed intent closed to new writes.
    let submitted: RegistrationSubmission;
    try {
      if (artifact === 'schema') {
        submitted = await backend.port.publishSchema(
          backend.context,
          work.registration.issuerId,
          work.definition.schemaDefinition,
        );
      } else {
        if (!schemaId) {
          throw new ValidationError([
            'Credential definition requires a schema ID',
          ]);
        }
        submitted = await backend.port.publishDefinition(
          backend.context,
          work.registration.issuerId,
          schemaId,
          options,
        );
      }
    } catch (error) {
      const status =
        error instanceof RegistrationBackendError
          ? error.status
          : axios.isAxiosError(error)
            ? error.response?.status
            : undefined;
      if (
        status &&
        status >= 400 &&
        status < 500 &&
        ![408, 429].includes(status)
      ) {
        await this.recordPublication(parameters, 'rejected');
      }
      throw error;
    }
    await this.recordPublication(
      parameters,
      submitted.state === 'failed' ? 'rejected' : 'submitted',
    );
    return submitted;
  }

  private async recordPublication(
    parameters: string[],
    state: 'rejected' | 'submitted',
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
        UPDATE anoncreds_publication_intent SET state = $4
        WHERE tenant_id = $1 AND connector_id = $2 AND artifact_key = $3
      `,
        [...parameters, state],
      );
    });
  }

  private toProgress(submission: RegistrationSubmission): ArtifactProgress {
    return {
      ...(submission.id ? { id: submission.id } : {}),
      ...(submission.jobId ? { jobId: submission.jobId } : {}),
      ...(submission.transactionId
        ? { transactionId: submission.transactionId }
        : {}),
      state: submission.state,
    };
  }

  private submissionFailure(
    submission: RegistrationSubmission,
  ): RegistrationBackendError {
    return new RegistrationBackendError(
      submission.status,
      submission.backendCode ?? 'REGISTRATION_REJECTED',
      submission.detail ?? 'The backend rejected artifact publication',
    );
  }

  private definitionOptions(definition: CredentialDefinition): {
    tag: string;
    status: { revocation: { enabled: boolean } };
  } {
    const options = definition.options ?? {};
    const status = options.status as
      { revocation?: { enabled?: boolean } } | undefined;
    const revocation = status?.revocation;
    return {
      tag: typeof options.tag === 'string' ? options.tag : 'default',
      status: { revocation: { enabled: revocation?.enabled ?? true } },
    };
  }

  private async saveProgress(work: RegistrationWork): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.update(
        CredentialDefinition,
        { id: work.definition.id, tenantId: work.tenantId, isActive: true },
        {
          registration: work.registration,
          externalId: work.definition.externalId,
        },
      );
      if (!result.affected) {
        throw new Error('Credential definition is no longer active');
      }
    });
  }

  private async persistWaiting(work: RegistrationWork): Promise<void> {
    work.definition.registrationState = 'pending';
    await this.persistOutcome(work, OperationState.PROCESSING, undefined, true);
  }

  private async persistFailure(
    error: unknown,
    work: RegistrationWork,
    stage: string,
  ): Promise<void> {
    const failure = this.classifyFailure(error, stage);
    this.logger.warn({
      message: `AnonCreds registration ${work.definition.id} failed`,
      stage,
      backend_status: failure.status,
      backend_code: failure.code,
    });
    work.registration.stage = stage;
    work.definition.registrationState = 'failed';
    await this.persistOutcome(work, OperationState.FAILED, failure);
  }

  private classifyFailure(error: unknown, stage: string): RegistrationFailure {
    const status =
      error instanceof RegistrationBackendError
        ? error.status
        : axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
    const code =
      error instanceof RegistrationBackendError ? error.backendCode : undefined;
    const detail =
      error instanceof RegistrationBackendError
        ? error.detail
        : error instanceof ValidationError
          ? error.issues.join('; ')
          : 'AnonCreds registration could not be completed';
    const problem = RegistrationProblemDetailsDto.create({
      detail,
      stage,
      retryable: false,
      ...(status !== undefined ? { backend_status: status } : {}),
      ...(code ? { backend_code: code } : {}),
    });
    return { detail, status, code, problem };
  }

  private async persistOutcome(
    work: RegistrationWork,
    state: OperationState,
    failure?: RegistrationFailure,
    scheduleFollowUp = false,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        CredentialDefinition,
        { id: work.definition.id, tenantId: work.tenantId },
        {
          registrationState: work.definition.registrationState,
          registration: work.registration,
          externalId: work.definition.externalId,
        },
      );
      await this.operations.transitionState(
        work.operationId,
        state,
        {
          credential_definition_id: work.definition.id,
          external_id: work.definition.externalId,
          registration: this.progressResult(work),
          ...(failure
            ? {
                code: 'REGISTRATION_FAILED',
                message: failure.detail,
                problem_details: failure.problem,
              }
            : {}),
        },
        manager,
        work.tenantId,
      );
      if (scheduleFollowUp && work.checks < MAX_WAIT_CHECKS) {
        await this.jobs.sendInTransaction(
          manager,
          JOB_QUEUES.DEFINITION_REGISTER,
          {
            tenantId: work.tenantId,
            definitionId: work.definition.id,
            checks: work.checks + 1,
          },
          {
            startAfter: WAIT_INTERVAL_SECONDS,
            singletonKey: work.definition.id,
          },
        );
      }
    });
  }

  private async transitionOperation(
    work: RegistrationWork,
    state: OperationState,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.operations.transitionState(
        work.operationId,
        state,
        {
          credential_definition_id: work.definition.id,
          external_id: work.definition.externalId,
          registration: this.progressResult(work),
        },
        manager,
        work.tenantId,
      );
    });
  }

  private async failWithoutOperation(
    definition: CredentialDefinition,
    stage: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        CredentialDefinition,
        { id: definition.id, tenantId: definition.tenantId },
        { registrationState: 'failed' },
      );
    });
    this.logger.warn({
      message: `AnonCreds registration ${definition.id} failed without an operation`,
      stage,
    });
  }

  private progressResult(work: RegistrationWork): Record<string, unknown> {
    const { registration } = work;
    const stage = registration.stage ?? 'preflight';
    let artifact: 'schema' | 'credential_definition' | null = null;
    let current: ArtifactProgress | undefined;

    if (
      stage.startsWith('schema_') ||
      stage === 'awaiting_schema_endorsement' ||
      stage === 'awaiting_schema_discovery'
    ) {
      artifact = 'schema';
      current = registration.schema;
    } else if (
      stage.startsWith('definition_') ||
      stage === 'awaiting_definition_endorsement' ||
      stage === 'awaiting_definition_discovery' ||
      stage === 'awaiting_revocation_registry'
    ) {
      artifact = 'credential_definition';
      current = registration.definition;
    }

    return {
      stage,
      artifact,
      ...(current
        ? {
            id: current.id ?? null,
            job_id: current.jobId ?? null,
            transaction_id: current.transactionId ?? null,
            state: current.state ?? null,
          }
        : {}),
    };
  }
}
