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

import {
  AdapterRegistry,
  toPortConnectorType,
} from '../adapter-registry/adapter-registry.service';
import { ResolvedAdapter } from '../adapter-registry/adapter-registry.types';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import {
  Connection,
  ConnectionProtocol,
  ConnectionState,
} from '../connection/connection.entity';
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

/** Connection states from which a DIDComm proof request can actually be sent. */
const USABLE_CONNECTION_STATES: readonly ConnectionState[] = [
  ConnectionState.ACTIVE,
  ConnectionState.COMPLETED,
];

interface ResolvedRequest {
  readonly name: string;
  readonly requestedAttributes: readonly { name: string }[];
  readonly requestedPredicates?: readonly RequestedPredicate[];
  readonly format?: CredentialDefinitionFormat;
}

/**
 * Backs POST /tenants/:tenantId/presentations/request.
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
 *
 * Known MVP gap: the port layer's `PresentationRequest` only carries
 * attribute/predicate selection (`RequestedAttribute[]`/
 * `RequestedPredicate[]`), not full DIF Presentation Exchange semantics.
 * `submission_requirements` (descriptor-group selection) and per-field
 * `filter` constraints (issuer/schema/value restrictions on which
 * credentials satisfy an attribute) cannot be carried through to the
 * adapter today; rather than silently drop them, a `presentation_definition`
 * using either is rejected with 400 — see `assertConstraintsRepresentable`.
 * Likewise, raw mode's `format` is used only to pick a compatible adapter:
 * `PresentationRequest` has no format field, so an adapter supporting
 * multiple formats cannot be told which one to use for a given request.
 * Extending the port DTO to close either gap is a `libs/credential-ports`
 * change outside this endpoint's scope.
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

    this.assertConnectionUsable(connection);

    // Resolved before any DB writes, same rationale as
    // CredentialOfferService: a connector-configuration problem (no active
    // connector of the connection's own type, format not supported by it,
    // ...) must not create a stillborn Operation row.
    const resolvedAdapter = await this.resolveAdapter(
      tenantId,
      connection,
      resolved.format,
    );

    const operation = await this.operationService.createOperation({
      tenantId,
      type: OPERATION_TYPE.PRESENTATION_REQUEST,
      request: {
        method: 'POST',
        path: `${API_BASE_PATH}/tenants/${tenantId}/presentations/request`,
        body: { ...dto },
      },
    });

    return this.executeRequest(
      tenantId,
      operation,
      connection,
      resolved,
      resolvedAdapter,
    );
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
   * A DIDComm proof request can only be sent over a connection that has
   * actually completed the DIDComm connection protocol (ACTIVE/COMPLETED —
   * see state-mapping.ts's CONNECTION_STATE_RANK) and that uses a DIDComm
   * wire protocol in the first place; an OPENID4VC connection, or one still
   * mid-handshake (invited/requested/responded) or abandoned, can never
   * receive one.
   */
  private assertConnectionUsable(connection: Connection): void {
    if (!USABLE_CONNECTION_STATES.includes(connection.state)) {
      throw new BadRequestException(
        `Connection '${connection.id}' is not established yet (state: '${connection.state}').`,
      );
    }

    if (connection.protocol === ConnectionProtocol.OPENID4VC) {
      throw new BadRequestException(
        `Connection '${connection.id}' does not use a DIDComm protocol.`,
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

      this.assertConstraintsRepresentable(profile.presentationDefinition);

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

    const presentationDefinition = dto.presentationDefinition as Record<
      string,
      unknown
    >;

    this.assertConstraintsRepresentable(presentationDefinition);

    const requestedAttributes = extractRequestedAttributes(
      presentationDefinition,
    );

    return {
      name: 'ad-hoc-presentation-request',
      requestedAttributes: requestedAttributes.map((name) => ({ name })),
      format: dto.format,
    };
  }

  /**
   * Rejects a `presentation_definition` using a construct this endpoint
   * cannot faithfully carry through to the adapter — see this service's own
   * doc comment. Silently ignoring either would let the agent request a
   * weaker or different proof than the caller actually specified.
   */
  private assertConstraintsRepresentable(
    presentationDefinition: Record<string, unknown>,
  ): void {
    if (
      Array.isArray(presentationDefinition.submission_requirements) &&
      presentationDefinition.submission_requirements.length > 0
    ) {
      throw new BadRequestException(
        'presentation_definition.submission_requirements is not supported yet.',
      );
    }

    const inputDescriptors = presentationDefinition.input_descriptors;

    if (!Array.isArray(inputDescriptors)) {
      return;
    }

    for (const descriptor of inputDescriptors) {
      const fields = (
        descriptor as { constraints?: { fields?: unknown } } | undefined
      )?.constraints?.fields;

      if (!Array.isArray(fields)) {
        continue;
      }

      const hasFilter = fields.some(
        (field) =>
          (field as { filter?: unknown } | undefined)?.filter !== undefined,
      );

      if (hasFilter) {
        throw new BadRequestException(
          'presentation_definition field filters (issuer/schema/value restrictions) are not supported yet; only attribute selection is.',
        );
      }
    }
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
   *
   * `VerificationPredicateDto.value` is only shape-validated as a non-empty
   * string at profile create/update time (it must render as DIF PE `filter`
   * JSON), not as a number — so a non-numeric value must be rejected here,
   * before it silently becomes `NaN` on the port's `pValue: number`.
   */
  private mapPredicates(
    predicates?: readonly Record<string, unknown>[] | null,
  ): RequestedPredicate[] | undefined {
    if (!predicates || predicates.length === 0) {
      return undefined;
    }

    return predicates.map((predicate) => {
      const pValue = Number(predicate.value);

      if (Number.isNaN(pValue)) {
        throw new BadRequestException(
          `Verification profile predicate for attribute '${String(
            predicate.attribute,
          )}' has a non-numeric value.`,
        );
      }

      return {
        name: String(predicate.attribute),
        pType: String(predicate.condition),
        pValue,
      };
    });
  }

  /**
   * Resolved by the connection's own `connectorType` — not just the
   * tenant's default/sole connector — so a request bound to this connection
   * can never be routed to a different connector the tenant also happens to
   * have configured. `AdapterError` (no active connector of that type, or
   * the requested format isn't supported by it) is a request-input problem,
   * not a server error, mirroring CredentialOfferService.resolveAdapter.
   */
  private async resolveAdapter(
    tenantId: string,
    connection: Connection,
    format?: CredentialDefinitionFormat,
  ): Promise<ResolvedAdapter> {
    const portFormat = format ? toPortCredentialFormat(format) : undefined;
    const connectorType = toPortConnectorType(connection.connectorType);

    try {
      return await this.adapterRegistry.resolve(tenantId, portFormat, {
        connectorType,
      });
    } catch (error) {
      if (error instanceof AdapterError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  /**
   * Calls the adapter and durably transitions `operation` off PENDING.
   * Mirrors CredentialRevokeService.executeRevoke/CredentialActionService.
   * executeAction's transactional guarded-transition pattern; unlike those,
   * there is no pre-existing externalId to correlate against — this call
   * creates the Operation the protocol.state-change worker will later
   * correlate by the externalId this call itself learns from the adapter.
   *
   * That does leave a narrow, inherent window between the adapter call
   * returning and this call's own guarded transition committing the
   * externalId: a `present_proof` webhook for this exact exchange arriving
   * inside that window would find no Operation to correlate against yet
   * (ProtocolStateChangeService.applyOperationOutcome's lookup is
   * best-effort only) and be dropped. This is not unique to this endpoint —
   * CredentialOfferService has the identical shape (externalId is only
   * known once its own adapter call returns, and is likewise persisted
   * atomically with the guarded transition immediately after) — and closing
   * it fully would need either a port-layer change to pre-assign a
   * correlation id before the adapter call, or making the webhook worker
   * retry an unmatched delivery instead of treating it as a permanent
   * no-op; both are out of scope for a single endpoint handler.
   */
  private async executeRequest(
    tenantId: string,
    operation: Operation,
    connection: Connection,
    resolved: ResolvedRequest,
    resolvedAdapter: ResolvedAdapter,
  ): Promise<Operation> {
    // ACTIVE/COMPLETED (already enforced by assertConnectionUsable) is only
    // reached once the connection.create job has recorded the agent's own
    // connection id — externalConnectionId is otherwise null while that job
    // is still pending — so this should be unreachable in practice; it
    // guards the adapter boundary against ever addressing a connection the
    // agent has never heard of, and narrows the nullable column to the
    // string the port requires.
    if (!connection.externalConnectionId) {
      throw new BadRequestException(
        `Connection '${connection.id}' has no external connection id yet.`,
      );
    }

    const externalConnectionId = connection.externalConnectionId;
    let exchange;

    try {
      exchange = await resolvedAdapter.adapter.requestPresentation(
        resolvedAdapter.context,
        {
          // The adapter's own connection identifier, not this service's
          // local Connection.id — the local UUID would address a
          // connection the agent has never heard of.
          connectionId: externalConnectionId,
          name: resolved.name,
          requestedAttributes: resolved.requestedAttributes,
          ...(resolved.requestedPredicates
            ? { requestedPredicates: resolved.requestedPredicates }
            : {}),
        },
      );
    } catch (error) {
      return this.failOperation(tenantId, operation, error);
    }

    const outcome = resolveProtocolOutcome('present_proof', exchange.state) ?? {
      operationState: OperationState.PROCESSING,
    };
    const externalId = exchange.externalId ?? exchange.id;

    // The Operation contract documents `result` as null while
    // pending/processing (OperationResponseDto, ProtocolStateChangeService.
    // resolveOperationResult follows the same contract) — only a terminal
    // outcome gets a result payload here.
    const result =
      outcome.operationState === OperationState.FAILED
        ? {
            code: 'PRESENTATION_REQUEST_FAILED',
            message: exchange.error ?? 'Presentation request failed',
          }
        : outcome.operationState === OperationState.COMPLETED
          ? { ...exchange }
          : undefined;

    const { current, won } = await this.dataSource.transaction(
      async (manager) => {
        const updated = await this.operationService.transitionStateIfForward(
          operation.id,
          outcome.operationState,
          operationStatesBelow(outcome.operationState),
          result,
          manager,
          externalId,
        );

        if (!updated) {
          const existing = await this.operationRepository.findById(
            operation.id,
            manager,
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
              resourceId: externalId,
              occurredAt: new Date().toISOString(),
            },
          );
        }

        return { current: updated, won: true };
      },
    );

    // Only the call that actually won its own guarded transition may emit
    // the audit entry/domain event — a call that lost the race (e.g. a
    // webhook already settled this Operation first) must not re-fire either,
    // same rule CredentialRevokeService/CredentialActionService follow.
    if (won) {
      await this.emitAudit(tenantId, operation.id, current.state);

      if (outcome.event) {
        this.eventEmitter.emit(outcome.event, { tenantId, externalId });
      }
    }

    return current;
  }

  /**
   * Guard-transitions `operation` to FAILED for any error the adapter call
   * raises — not only `AdapterError` — since the currently-registered
   * Traction adapter's `requestPresentation` is still a stub that throws
   * `NotImplementedException`, and any other unexpected error leaves the
   * operation stuck PENDING forever while the caller still sees an HTTP
   * error. The original error is always rethrown afterwards so its own HTTP
   * status reaches the caller unchanged.
   */
  private async failOperation(
    tenantId: string,
    operation: Operation,
    error: unknown,
  ): Promise<never> {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AdapterError ? error.code : 'ADAPTER_ERROR';

    this.logger.warn(
      `Presentation request failed for operation '${operation.id}': ${message}`,
    );

    const { current, won } = await this.dataSource.transaction(
      async (manager) => {
        const updated = await this.operationService.transitionStateIfForward(
          operation.id,
          OperationState.FAILED,
          operationStatesBelow(OperationState.FAILED),
          { code, message },
          manager,
        );

        if (!updated) {
          const existing = await this.operationRepository.findById(
            operation.id,
            manager,
          );

          if (!existing) {
            throw new NotFoundException('Operation not found');
          }

          return { current: existing, won: false };
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

        return { current: updated, won: true };
      },
    );

    if (won) {
      await this.emitAudit(tenantId, operation.id, current.state);
    }

    throw error;
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
