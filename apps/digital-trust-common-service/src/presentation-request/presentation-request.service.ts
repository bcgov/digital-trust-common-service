import { randomBytes } from 'crypto';

import type { AuthContext } from '@app/auth';
import {
  AdapterError,
  RequestedPredicate,
  SubmissionRejectedError,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  AdapterRegistry,
  toPortConnectorType,
} from '../adapter-registry/adapter-registry.service';
import { ResolvedAdapter } from '../adapter-registry/adapter-registry.types';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { assertTenantAccess } from '../common/assert-tenant-access';
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
import { operationStatesBelow } from '../protocol-state-change/state-mapping';
import type { PresentationDefinition } from '../verification-profile/presentation-definition.entity';
import { PresentationDefinitionRepository } from '../verification-profile/presentation-definition.repository';
import { extractRequestedAttributes } from '../verification-profile/presentation-definition.validator';
import {
  VerificationProfile,
  VerificationProfileStatus,
} from '../verification-profile/verification-profile.entity';
import { VerificationProfileRepository } from '../verification-profile/verification-profile.repository';

import { CreatePresentationRequestDto } from './dto/create-presentation-request.dto';
import { RequestPresentationDto } from './dto/request-presentation.dto';
import { PresentationExchangeLifecycleService } from './presentation-exchange-lifecycle.service';
import { PresentationExchangeRepository } from './presentation-exchange.repository';
import { presentationSteps } from './presentation-steps';

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
  readonly deliveryProtocol?: ConnectionProtocol;
  readonly profile?: VerificationProfile;
  readonly definition?: PresentationDefinition;
}

/**
 * Backs POST /tenants/:tenantId/presentations/request.
 *
 * MVP is DIDComm-only: `connection_id` is required on every request (both
 * modes) since OID4VP (the connectionless flow the openapi contract
 * documents as "post-MVP") has no adapter support yet — see
 * `docs/openapi.yaml`'s `RequestPresentationRequest.connection_id`
 * description. The exchange retains protocol identity and non-sensitive
 * provenance; the operation retains transient request and proof data.
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
    private readonly dataSource: DataSource,
    private readonly presentationDefinitions: PresentationDefinitionRepository,
    private readonly presentationExchanges: PresentationExchangeRepository,
    private readonly lifecycle: PresentationExchangeLifecycleService,
  ) {}

  public async create(
    tenantId: string,
    dto: CreatePresentationRequestDto,
    auth: AuthContext,
  ): Promise<Operation> {
    assertTenantAccess(auth, tenantId);
    return this.requestPresentation(
      tenantId,
      {
        verificationProfileId: dto.verificationProfileId,
        connectionId: dto.delivery.connectionId,
      },
      'presentation-requests',
    );
  }

  public async get(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<Operation> {
    assertTenantAccess(auth, tenantId);
    const operation = await this.operationService.getForTenant(tenantId, id);
    if (operation.type !== OPERATION_TYPE.PRESENTATION_REQUEST) {
      throw new NotFoundException('Presentation request not found');
    }
    return operation;
  }

  public async requestPresentation(
    tenantId: string,
    dto: RequestPresentationDto,
    resource:
      | 'presentations/request'
      | 'presentation-requests' = 'presentations/request',
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
    if (
      resolved.deliveryProtocol &&
      connection.protocol !== resolved.deliveryProtocol
    ) {
      throw new BadRequestException(
        'Connection protocol does not match the verification profile delivery.',
      );
    }

    // Resolved before any DB writes, same rationale as
    // CredentialOfferService: a connector-configuration problem (no active
    // connector of the connection's own type, format not supported by it,
    // ...) must not create a stillborn Operation row.
    const resolvedAdapter = await this.resolveAdapter(
      tenantId,
      connection,
      resolved.format,
    );
    if (
      toPortConnectorType(resolvedAdapter.connector.connectorType) !==
      toPortConnectorType(connection.connectorType)
    ) {
      throw new BadRequestException(
        'Selected connector does not match the connection type.',
      );
    }

    if (!connection.externalConnectionId) {
      throw new BadRequestException(
        `Connection '${connection.id}' has no external connection id yet.`,
      );
    }
    const proofRequest = {
      connectionId: connection.externalConnectionId,
      name: resolved.name,
      nonce: (BigInt(`0x${randomBytes(10).toString('hex')}`) || 1n).toString(),
      requestedAttributes: resolved.requestedAttributes,
      requestedPredicates: resolved.requestedPredicates,
    };
    const operation = await this.dataSource.transaction(async (manager) => {
      const currentConnection = await manager.findOne(Connection, {
        where: { id: connection.id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !currentConnection ||
        currentConnection.externalConnectionId !== proofRequest.connectionId ||
        currentConnection.connectorId !== connection.connectorId ||
        currentConnection.protocol !== connection.protocol ||
        !USABLE_CONNECTION_STATES.includes(currentConnection.state)
      ) {
        throw new ConflictException('Connection changed; retry.');
      }
      if (resolved.profile && resolved.definition) {
        const profile = await this.verificationProfileRepository.findById(
          resolved.profile.id,
          manager,
          true,
        );
        const definition = await this.presentationDefinitions.findById(
          tenantId,
          resolved.definition.id,
          manager,
          true,
        );
        if (
          !profile ||
          profile.tenantId !== tenantId ||
          profile.status !== VerificationProfileStatus.PUBLISHED ||
          profile.presentationDefinitionId !== resolved.definition.id ||
          !definition ||
          definition.status !== VerificationProfileStatus.PUBLISHED ||
          JSON.stringify([profile.name, profile.version, profile.delivery]) !==
            JSON.stringify([
              resolved.profile.name,
              resolved.profile.version,
              resolved.profile.delivery,
            ]) ||
          JSON.stringify([
            definition.version,
            definition.presentationDefinition,
            definition.requestedAttributes,
            definition.predicates,
            definition.presentationFormat,
          ]) !==
            JSON.stringify([
              resolved.definition.version,
              resolved.definition.presentationDefinition,
              resolved.definition.requestedAttributes,
              resolved.definition.predicates,
              resolved.definition.presentationFormat,
            ])
        ) {
          throw new ConflictException(
            'Verification profile or presentation definition changed; retry.',
          );
        }
      }
      const exchange = await this.presentationExchanges.create(
        {
          tenantId,
          connectorId: resolvedAdapter.connector.id,
          connectionId: connection.id,
          externalConnectionId: proofRequest.connectionId,
          protocol: connection.protocol,
          format: resolvedAdapter.format,
          state: 'pending',
          submission: 'submitting',
          profileId: resolved.profile?.id ?? null,
          profileVersion: resolved.profile?.version ?? null,
          definitionId: resolved.definition?.id ?? null,
          definitionVersion: resolved.definition?.version ?? null,
          expectedEvidence: {
            nonce: proofRequest.nonce,
            attributes: resolved.requestedAttributes.map((item) => item.name),
            predicates: (resolved.requestedPredicates ?? []).map(
              ({ name, pType, pValue }) => ({ name, pType, pValue }),
            ),
          },
        },
        manager,
      );
      const created = await this.operationService.createOperation(
        {
          tenantId,
          type: OPERATION_TYPE.PRESENTATION_REQUEST,
          presentationExchangeId: exchange.id,
          steps: presentationSteps(0, OperationState.PENDING),
          request: {
            method: 'POST',
            path: `${API_BASE_PATH}/tenants/${tenantId}/${resource}`,
            body: {
              ...(resource === 'presentation-requests'
                ? {
                    verification_profile_id: dto.verificationProfileId,
                    delivery: { connection_id: dto.connectionId },
                  }
                : { ...dto }),
              snapshot: {
                connector_id: resolvedAdapter.connector.id,
                proof_request: proofRequest,
                options: { format: resolvedAdapter.format },
              },
            },
          },
        },
        manager,
      );
      exchange.requestOperationId = created.id;
      await manager.save(exchange);
      return created;
    });

    return this.executeRequest(
      tenantId,
      operation,
      connection,
      resolvedAdapter,
      proofRequest,
      resource === 'presentations/request',
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

      const definition = profile.definition;
      if (!definition) {
        throw new BadRequestException('Presentation definition was not found.');
      }
      this.assertConstraintsRepresentable(definition.presentationDefinition);

      return {
        name: profile.name,
        requestedAttributes: (
          definition.requestedAttributes ??
          extractRequestedAttributes(definition.presentationDefinition)
        ).map((name) => ({ name })),
        requestedPredicates: this.mapPredicates(definition.predicates),
        format: definition.presentationFormat ?? undefined,
        deliveryProtocol: profile.delivery
          ? ConnectionProtocol.DIDCOMM_V1
          : undefined,
        profile,
        definition,
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
        ...(connection.connectorId
          ? { connectorId: connection.connectorId }
          : { connectorType }),
      });
    } catch (error) {
      if (error instanceof AdapterError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  private async executeRequest(
    tenantId: string,
    operation: Operation,
    connection: Connection,
    resolvedAdapter: ResolvedAdapter,
    proofRequest: {
      connectionId: string;
      name: string;
      nonce: string;
      requestedAttributes: readonly { name: string }[];
      requestedPredicates?: readonly RequestedPredicate[];
    },
    rethrowFailure: boolean,
  ): Promise<Operation> {
    let exchange;
    try {
      exchange = await resolvedAdapter.adapter.requestPresentation(
        resolvedAdapter.context,
        proofRequest,
      );
    } catch (error) {
      return this.failOperation(tenantId, operation, error, rethrowFailure);
    }

    if (
      !exchange.id ||
      exchange.connectionId !== connection.externalConnectionId
    ) {
      return this.failOperation(
        tenantId,
        operation,
        new Error('Backend response correlation mismatch'),
        rethrowFailure,
      );
    }

    const externalId = exchange.externalId ?? exchange.id;
    let current: Operation;
    let won: boolean;
    try {
      ({ current, won } = await this.dataSource.transaction(async (manager) => {
        if (!operation.presentationExchangeId) {
          throw new NotFoundException('Presentation exchange not found');
        }
        const local = await this.presentationExchanges.lock(
          tenantId,
          operation.presentationExchangeId,
          manager,
        );
        if (!local)
          throw new NotFoundException('Presentation exchange not found');
        await this.presentationExchanges.observe(
          local,
          externalId,
          'pending',
          manager,
        );
        const updated = await this.operationService.transitionStateIfForward(
          operation.id,
          OperationState.PROCESSING,
          operationStatesBelow(OperationState.PROCESSING),
          undefined,
          manager,
          externalId,
          presentationSteps(1, OperationState.PROCESSING),
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

        return { current: updated, won: true };
      }));
    } catch {
      throw new InternalServerErrorException(
        `Submission may have succeeded. Operation ${operation.id}, presentation exchange ${operation.presentationExchangeId}; do not resend.`,
      );
    }
    if (won) {
      await this.emitAudit(tenantId, operation.id, current.state);
    }
    try {
      await this.lifecycle.observe(
        tenantId,
        resolvedAdapter.connector.id,
        externalId,
      );
    } catch {
      this.logger.warn(
        `Presentation observation failed for operation '${operation.id}'; reconcile without resending.`,
      );
    }
    return (
      (await this.operationRepository.findByIdForTenant(
        operation.id,
        tenantId,
      )) ?? current
    );
  }

  private async failOperation(
    tenantId: string,
    operation: Operation,
    error: unknown,
    rethrowFailure: boolean,
  ): Promise<Operation> {
    const rejected = error instanceof SubmissionRejectedError;
    const code = rejected ? 'SUBMISSION_REJECTED' : 'SUBMISSION_UNCERTAIN';
    const message = rejected
      ? 'The presentation request was not submitted.'
      : 'Submission may have succeeded; do not resend.';

    this.logger.warn(
      `Presentation request failed for operation '${operation.id}': ${code}`,
    );

    let current: Operation;
    let won: boolean;
    try {
      ({ current, won } = await this.dataSource.transaction(async (manager) => {
        if (!operation.presentationExchangeId) {
          throw new NotFoundException('Presentation exchange not found');
        }
        const local = await this.presentationExchanges.lock(
          tenantId,
          operation.presentationExchangeId,
          manager,
        );
        if (!local)
          throw new NotFoundException('Presentation exchange not found');
        local.submission = rejected ? 'rejected' : 'uncertain';
        if (rejected) local.state = 'failed';
        await manager.save(local);
        const updated = await this.operationService.transitionStateIfForward(
          operation.id,
          OperationState.FAILED,
          operationStatesBelow(OperationState.FAILED),
          { code, message },
          manager,
          undefined,
          presentationSteps(0, OperationState.FAILED),
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
      }));
    } catch {
      throw new InternalServerErrorException(
        `Submission outcome could not be saved. Operation ${operation.id}, presentation exchange ${operation.presentationExchangeId}; do not resend.`,
      );
    }

    if (won) {
      await this.emitAudit(tenantId, operation.id, current.state);
    }

    if (rethrowFailure) {
      throw new InternalServerErrorException(
        `${message} Operation ${operation.id}, presentation exchange ${operation.presentationExchangeId}.`,
      );
    }
    return current;
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
