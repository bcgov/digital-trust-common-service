import { AdapterError, RequestedPredicate } from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { ConnectionRepository } from '../connection/connection.repository';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { toPortCredentialFormat } from '../credential-definition/credential-definition.service';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import {
  operationStatesBelow,
  resolveProtocolOutcome,
} from '../protocol-state-change/state-mapping';
import { extractRequestedAttributes } from '../verification-profile/presentation-definition.validator';
import {
  VerificationProfile,
  VerificationProfileStatus,
} from '../verification-profile/verification-profile.entity';
import { VerificationProfileRepository } from '../verification-profile/verification-profile.repository';

import { RequestPresentationDto } from './dto/request-presentation.dto';

/** UUIDv1-v5, case-insensitive — matches how other services (e.g. ParseUUIDPipe) recognize an id vs. a name-like string. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ResolvedRequest {
  readonly name: string;
  readonly requestedAttributes: readonly { name: string }[];
  readonly requestedPredicates?: readonly RequestedPredicate[];
  readonly format?: CredentialDefinitionFormat;
}

/**
 * Backs POST /tenants/:tenantId/presentations/request (CA-04, #54).
 *
 * MVP is DIDComm-only: `connection_id` is required on every request (both
 * modes) since OID4VP (the connectionless flow the openapi contract
 * documents as "post-MVP") has no adapter support yet — see
 * `docs/openapi.yaml`'s `RequestPresentationRequest.connection_id`
 * description. There is no persisted entity analogous to `Credential` for a
 * presentation/proof request: the created `Operation` is the durable
 * record, and the protocol.state-change worker's existing `present_proof`
 * wiring (state-mapping.ts) already completes it from the resulting
 * webhook — this service only needs the synchronous submission path.
 */
@Injectable()
export class PresentationRequestService {
  private readonly logger = new Logger(PresentationRequestService.name);

  public constructor(
    private readonly verificationProfileRepository: VerificationProfileRepository,
    private readonly connectionRepository: ConnectionRepository,
    private readonly operationRepository: OperationRepository,
    private readonly operationService: OperationService,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly domainAudit: DomainAuditService,
    private readonly jobsService: JobsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  public async requestPresentation(
    tenantId: string,
    dto: RequestPresentationDto,
  ): Promise<Operation> {
    this.assertExactlyOneMode(dto);

    // MVP gate: OID4VP (connectionless) has no adapter support yet, so a
    // request that omits connection_id — in either mode — cannot be
    // fulfilled. Checked up front, right after the cheap mode-shape check
    // and before any profile lookup or structural validation, so a request
    // that can never succeed fails fast rather than paying for work whose
    // result will be discarded.
    if (!dto.connectionId) {
      throw new BadRequestException(
        'OID4VP presentation requests are not supported yet; connection_id is required.',
      );
    }

    const [resolved, connection] = await Promise.all([
      this.resolveRequest(tenantId, dto),
      this.connectionRepository.findById(dto.connectionId),
    ]);

    if (!connection || connection.tenantId !== tenantId) {
      throw new BadRequestException(
        `Connection '${dto.connectionId}' was not found for this tenant.`,
      );
    }

    const operation = await this.operationService.createOperation({
      tenantId,
      type: OPERATION_TYPE.PRESENTATION_REQUEST,
      request: {
        method: 'POST',
        path: `${API_BASE_PATH}/tenants/${tenantId}/presentations/request`,
        body: { ...dto },
      },
    });

    return this.executeRequest(tenantId, operation, connection.id, resolved);
  }

  private assertExactlyOneMode(dto: RequestPresentationDto): void {
    const hasProfile = dto.verificationProfileId !== undefined;
    const hasRaw = dto.presentationDefinition !== undefined;

    if (hasProfile === hasRaw) {
      throw new BadRequestException(
        'Provide exactly one of verification_profile_id or presentation_definition.',
      );
    }
  }

  /**
   * Validates the two mutually exclusive request modes and returns the
   * agent-agnostic attribute/predicate/format data the adapter call needs,
   * regardless of which mode supplied it.
   */
  private async resolveRequest(
    tenantId: string,
    dto: RequestPresentationDto,
  ): Promise<ResolvedRequest> {
    if (dto.verificationProfileId !== undefined) {
      const profile = await this.resolveProfile(
        tenantId,
        dto.verificationProfileId,
      );

      return {
        name: profile.name,
        requestedAttributes: (
          profile.requestedAttributes ??
          extractRequestedAttributes(profile.presentationDefinition)
        ).map((name) => ({ name })),
        requestedPredicates: this.mapPredicates(profile.predicates),
      };
    }

    if (!dto.format) {
      throw new BadRequestException(
        'format is required when presentation_definition is provided.',
      );
    }

    const requestedAttributes = extractRequestedAttributes(
      dto.presentationDefinition as Record<string, unknown>,
    );

    return {
      name: 'ad-hoc-presentation-request',
      requestedAttributes: requestedAttributes.map((name) => ({ name })),
      format: dto.format,
    };
  }

  private async resolveProfile(
    tenantId: string,
    profileIdOrName: string,
  ): Promise<VerificationProfile> {
    const profile = UUID_REGEX.test(profileIdOrName)
      ? await this.verificationProfileRepository.findById(profileIdOrName)
      : await this.resolveProfileByNameVersion(tenantId, profileIdOrName);

    if (!profile || profile.tenantId !== tenantId) {
      throw new BadRequestException(
        `Verification profile '${profileIdOrName}' was not found.`,
      );
    }

    if (profile.status !== VerificationProfileStatus.PUBLISHED) {
      throw new BadRequestException(
        `Verification profile '${profileIdOrName}' is not published.`,
      );
    }

    return profile;
  }

  private async resolveProfileByNameVersion(
    tenantId: string,
    value: string,
  ): Promise<VerificationProfile | null> {
    const separatorIndex = value.indexOf('/');

    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      throw new BadRequestException(
        "verification_profile_id must be a UUID or a 'name/version' string.",
      );
    }

    const name = value.slice(0, separatorIndex);
    const version = value.slice(separatorIndex + 1);

    return this.verificationProfileRepository.findByNameAndVersion(
      tenantId,
      name,
      version,
    );
  }

  /**
   * Maps a verification profile's persisted predicates (`attribute` /
   * `condition` / `value`, per `VerificationPredicateDto`) onto the port
   * layer's `RequestedPredicate` (`name` / `pType` / `pValue`). Raw mode has
   * no predicates field in the documented contract (`RequestPresentationRequest`
   * only carries `presentation_definition` + `format`), so this is
   * profile-mode only.
   */
  private mapPredicates(
    predicates?: readonly Record<string, unknown>[] | null,
  ): RequestedPredicate[] | undefined {
    if (!predicates || predicates.length === 0) {
      return undefined;
    }

    return predicates.map((predicate) => ({
      name: String(predicate.attribute),
      pType: String(predicate.condition),
      pValue: Number(predicate.value),
    }));
  }

  /**
   * Calls the adapter and durably transitions `operation` off PENDING.
   * Mirrors CredentialRevokeService.executeRevoke/CredentialActionService.
   * executeAction's transactional guarded-transition pattern; unlike those,
   * there is no pre-existing externalId to correlate against — this call
   * creates the Operation the protocol.state-change worker will later
   * correlate by the externalId this call itself learns from the adapter.
   */
  private async executeRequest(
    tenantId: string,
    operation: Operation,
    connectionId: string,
    resolved: ResolvedRequest,
  ): Promise<Operation> {
    try {
      const portFormat = resolved.format
        ? toPortCredentialFormat(resolved.format)
        : undefined;
      const { adapter, context } = await this.adapterRegistry.resolve(
        tenantId,
        portFormat,
      );

      const exchange = await adapter.requestPresentation(context, {
        connectionId,
        name: resolved.name,
        requestedAttributes: resolved.requestedAttributes,
        ...(resolved.requestedPredicates
          ? { requestedPredicates: resolved.requestedPredicates }
          : {}),
      });

      const outcome = resolveProtocolOutcome(
        'present_proof',
        exchange.state,
      ) ?? { operationState: OperationState.PROCESSING };

      const { current, won } = await this.dataSource.transaction(
        async (manager) => {
          const updated = await this.operationService.transitionStateIfForward(
            operation.id,
            outcome.operationState,
            operationStatesBelow(outcome.operationState),
            { ...exchange },
            manager,
            exchange.externalId ?? exchange.id,
          );

          if (!updated) {
            const existing = await this.operationRepository.findById(
              operation.id,
            );

            if (!existing) {
              throw new NotFoundException('Operation not found');
            }

            return { current: existing, won: false };
          }

          if (outcome.event) {
            await this.jobsService.sendInTransaction(
              manager,
              JOB_QUEUES.WEBHOOK_DISPATCH,
              {
                tenantId,
                event: outcome.event,
                resourceId: exchange.externalId ?? exchange.id,
                occurredAt: new Date().toISOString(),
              },
            );
          }

          return { current: updated, won: true };
        },
      );

      await this.emitAudit(tenantId, operation.id, current.state);

      if (won && outcome.event) {
        this.eventEmitter.emit(outcome.event, {
          tenantId,
          externalId: exchange.externalId ?? exchange.id,
        });
      }

      return current;
    } catch (error) {
      if (!(error instanceof AdapterError)) {
        throw error;
      }

      this.logger.warn(
        `Presentation request failed for operation '${operation.id}': ${error.message}`,
      );

      const current = await this.dataSource.transaction(async (manager) => {
        const failed = await this.operationService.transitionStateIfForward(
          operation.id,
          OperationState.FAILED,
          operationStatesBelow(OperationState.FAILED),
          { code: error.code, message: error.message },
          manager,
        );

        if (!failed) {
          const existing = await this.operationRepository.findById(
            operation.id,
          );

          if (!existing) {
            throw new NotFoundException('Operation not found');
          }

          return existing;
        }

        await this.jobsService.sendInTransaction(
          manager,
          JOB_QUEUES.WEBHOOK_DISPATCH,
          {
            tenantId,
            event: 'presentation.request.failed',
            resourceId: operation.id,
            occurredAt: new Date().toISOString(),
          },
        );

        return failed;
      });

      await this.emitAudit(tenantId, operation.id, current.state);

      return current;
    }
  }

  private async emitAudit(
    tenantId: string,
    operationId: string,
    state: OperationState,
  ): Promise<void> {
    await this.domainAudit.emit({
      tenantId,
      action: AuditAction.VERIFY,
      resourceType: 'presentation_request',
      resourceId: operationId,
      metadata: { state },
    });
  }
}
