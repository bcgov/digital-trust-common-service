import {
  AdapterError,
  BackendNotFoundError,
  CredentialAttribute,
  CredentialExchange,
  CredentialFormat as PortCredentialFormat,
  FormatValidatorRegistry,
  OfferCredentialRequest,
  validateOfferCredentialRequest,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { ResolvedAdapter } from '../adapter-registry/adapter-registry.types';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { ConnectionService } from '../connection/connection.service';
import {
  CredentialDefinition,
  CredentialDefinitionFormat,
} from '../credential-definition/credential-definition.entity';
import { CredentialDefinitionRepository } from '../credential-definition/credential-definition.repository';
import { toPortCredentialFormat } from '../credential-definition/credential-definition.service';
import { CredentialExchangeRepository } from '../credential-exchange/credential-exchange.repository';
import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from '../issuance-profile/issuance-profile.entity';
import { IssuanceProfileRepository } from '../issuance-profile/issuance-profile.repository';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import { ProtocolStateChangeService } from '../protocol-state-change/protocol-state-change.service';
import {
  credentialStatesBelow,
  operationStatesBelow,
  resolveProtocolOutcome,
} from '../protocol-state-change/state-mapping';

import {
  mergeAttributeDefaults,
  toCredentialAttributes,
} from './attribute-mapping.util';
import { Credential, CredentialState } from './credential.entity';
import { CredentialRepository } from './credential.repository';
import { OfferCredentialRequestDto } from './dto/offer-credential-request.dto';

/**
 * Everything resolveCredentialSource() needs to build the port-layer
 * OfferCredentialRequest and the new Credential row, regardless of whether
 * the caller went through profile mode or legacy (credential_definition_id)
 * mode.
 */
interface ResolvedCredentialSource {
  /** Local DB UUID — only for internal profile/metadata relationships. */
  readonly credentialDefinitionId: string;
  /**
   * The connector/ledger `cred_def_id` (CredentialDefinition.externalId) —
   * this, not the local UUID, is what the adapter/Traction needs.
   */
  readonly externalCredentialDefinitionId: string;
  readonly format: CredentialDefinitionFormat;
  readonly connectorId?: string;
  readonly schemaDefinition: Readonly<Record<string, unknown>>;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly issuanceProfileId: string | null;
}

/**
 * Backs POST /tenants/:tenantId/credentials/offer.
 *
 * Format comes from stored metadata; delivery is explicit and currently
 * limited to DIDComm v1. Subject claims are unsigned proposed content.
 *
 * The resulting Operation's `externalId` carries the back-end agent's
 * exchange id: the already-wired protocol.state-change worker correlates
 * later `issue_credential` webhooks back to this Operation/Credential pair
 * by that id (state-mapping.ts's `TOPIC_OPERATION_TYPES.issue_credential`
 * already includes `CREDENTIAL_OFFER`). Explicit reconciliation reuses
 * that same guarded state handling without resending.
 */
@Injectable()
export class CredentialOfferService {
  private readonly logger = new Logger(CredentialOfferService.name);

  public constructor(
    private readonly credentialRepository: CredentialRepository,
    private readonly credentialDefinitionRepository: CredentialDefinitionRepository,
    private readonly issuanceProfileRepository: IssuanceProfileRepository,
    private readonly operationRepository: OperationRepository,
    private readonly operationService: OperationService,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly formatValidatorRegistry: FormatValidatorRegistry,
    private readonly domainAudit: DomainAuditService,
    private readonly jobsService: JobsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
    private readonly connectionService: ConnectionService,
    private readonly protocolStateChanges: ProtocolStateChangeService,
    private readonly exchanges: CredentialExchangeRepository,
  ) {}

  public async reconcile(
    tenantId: string,
    operationId: string,
  ): Promise<Operation> {
    const operation = await this.operationRepository.findByIdForTenant(
      operationId,
      tenantId,
    );
    if (!operation || operation.type !== OPERATION_TYPE.CREDENTIAL_OFFER) {
      throw new NotFoundException('Credential offer operation not found');
    }
    if (!operation.externalId) {
      throw new ConflictException(
        'Offer submission has no verified exchange correlation; do not resend',
      );
    }
    const credential = await this.credentialRepository.findByExternalId(
      tenantId,
      operation.externalId,
    );
    if (
      !credential?.connectorId ||
      !credential.connectionId ||
      credential.operationId !== operation.id
    ) {
      throw new ConflictException(
        'Offer has no matching wallet-bound credential',
      );
    }
    const { adapter, context } = await this.resolveAdapter(
      tenantId,
      this.resolvePortFormat(credential.format),
      credential.connectorId,
    );
    let exchange: CredentialExchange;
    try {
      exchange = await adapter.getExchange(context, operation.externalId);
    } catch (error) {
      if (error instanceof BackendNotFoundError) {
        throw new ConflictException(
          'Backend credential exchange was not found',
        );
      }
      throw error;
    }
    if ((exchange.externalId ?? exchange.id) !== operation.externalId) {
      throw new ConflictException(
        'Backend returned a different credential exchange',
      );
    }
    if (credential.connectionId) {
      const connection = await this.connectionService.resolveIdentity(
        tenantId,
        credential.connectionId,
        credential.connectorId,
      );
      if (exchange.connectionId !== connection.externalConnectionId) {
        throw new ConflictException(
          'Exchange does not belong to the expected holder connection',
        );
      }
    }
    if (resolveProtocolOutcome('issue_credential', exchange.state)) {
      await this.protocolStateChanges.process({
        tenantId,
        topic: 'issue_credential',
        externalId: operation.externalId,
        protocolState: exchange.state,
        payload: {
          exchange_id: operation.externalId,
          state: exchange.state,
        },
      });
    }
    const updated = await this.operationRepository.findByIdForTenant(
      operationId,
      tenantId,
    );
    if (!updated)
      throw new NotFoundException('Credential offer operation not found');
    return updated;
  }

  public async offer(
    tenantId: string,
    dto: OfferCredentialRequestDto,
  ): Promise<Operation> {
    if (dto.delivery?.protocol !== 'didcomm-v1' || !dto.delivery.connectionId) {
      throw new BadRequestException(
        'A didcomm-v1 delivery connection is required',
      );
    }

    const source = await this.resolveCredentialSource(tenantId, dto);
    const portFormat = this.resolvePortFormat(source.format);

    const attributes = mergeAttributeDefaults(
      source.defaults,
      dto.credential.credentialSubject,
    );
    if (
      portFormat === PortCredentialFormat.AnonCreds &&
      Object.values(attributes).some(
        (value) =>
          !['string', 'number', 'boolean'].includes(typeof value) ||
          (typeof value === 'number' && !Number.isFinite(value)),
      )
    ) {
      throw new BadRequestException(
        'AnonCreds subject claims must be flat strings, finite numbers, or booleans',
      );
    }
    const credentialAttributes = toCredentialAttributes(attributes);

    this.assertAttributesValid(
      portFormat,
      source.schemaDefinition,
      credentialAttributes,
    );

    const offerRequest: OfferCredentialRequest = {
      connectionId: dto.delivery.connectionId,
      credentialDefinitionId: source.externalCredentialDefinitionId,
      format: portFormat,
      attributes: credentialAttributes,
      autoIssue: dto.options?.autoIssue ?? true,
    };

    // Final structural gate — the only current caller of this previously
    // unused port-level pre-check — run before any DB writes, same as the
    // adapter pre-flight resolve below.
    const structuralIssue = validateOfferCredentialRequest(offerRequest);

    if (structuralIssue) {
      throw new BadRequestException({
        message: 'Offer request failed validation',
        issues: structuralIssue.issues,
      });
    }

    // Resolved before any DB writes: a connector-configuration problem (no
    // active connector, format not supported by it, ...) must not create
    // stillborn Operation/Credential rows.
    const resolvedAdapter = await this.resolveAdapter(
      tenantId,
      portFormat,
      source.connectorId,
    );
    const connection = await this.connectionService.resolveForIssuance(
      tenantId,
      dto.delivery.connectionId,
      resolvedAdapter.connector.id,
    );

    const { operation, credential } = await this.dataSource.transaction(
      async (manager) => {
        const exchange = await this.exchanges.create(
          {
            tenantId,
            connectorId: resolvedAdapter.connector.id,
            connectionId: connection.id,
            role: 'issuer',
            protocol: dto.delivery.protocol,
            format: source.format,
            state: 'pending',
          },
          manager,
        );
        const createdOperation = await this.operationService.createOperation(
          {
            tenantId,
            exchangeId: exchange.id,
            type: OPERATION_TYPE.CREDENTIAL_OFFER,
            request: {
              method: 'POST',
              path: `${API_BASE_PATH}/tenants/${tenantId}/credentials/offer`,
              body: this.toRequestBody(dto),
            },
          },
          manager,
        );

        const createdCredential = await this.credentialRepository.create(
          {
            tenantId,
            issuanceProfileId: source.issuanceProfileId,
            connectionId: connection.id,
            connectorId: resolvedAdapter.connector.id,
            format: source.format,
            state: CredentialState.OFFERED,
            operationId: createdOperation.id,
            exchangeId: exchange.id,
            metadata: source.issuanceProfileId
              ? {}
              : { credentialDefinitionId: source.credentialDefinitionId },
          },
          manager,
        );

        return { operation: createdOperation, credential: createdCredential };
      },
    );

    return this.executeOffer(tenantId, operation, credential, resolvedAdapter, {
      ...offerRequest,
      connectionId: connection.externalConnectionId!,
    });
  }

  private async resolveCredentialSource(
    tenantId: string,
    dto: OfferCredentialRequestDto,
  ): Promise<ResolvedCredentialSource> {
    const hasProfile = dto.profileId !== undefined;
    const hasCredentialDefinition = dto.credentialDefinitionId !== undefined;

    if (hasProfile === hasCredentialDefinition) {
      throw new BadRequestException(
        'Exactly one of profile_id or credential_definition_id must be provided',
      );
    }

    return hasProfile
      ? this.resolveFromProfile(tenantId, dto.profileId as string)
      : this.resolveFromCredentialDefinition(
          tenantId,
          dto.credentialDefinitionId as string,
        );
  }

  /**
   * `profile_id` is either a UUID or a "name/version" string (see
   * `docs/openapi.yaml`'s OfferCredentialRequest schema) — disambiguated by
   * presence of `/`, split on the *last* one, since profile names are not
   * expected to contain a slash themselves.
   */
  private async findProfile(
    tenantId: string,
    profileId: string,
  ): Promise<IssuanceProfile | null> {
    const separatorIndex = profileId.lastIndexOf('/');

    if (separatorIndex === -1) {
      // The DTO only validates profile_id as a non-empty string, so a
      // malformed no-slash value (e.g. "not-a-uuid") must be rejected here
      // before it reaches a UUID-column lookup, or it surfaces as an
      // internal DB error instead of the documented 400.
      if (!isUUID(profileId)) {
        throw new BadRequestException(
          `profile_id '${profileId}' is not a valid UUID or 'name/version'`,
        );
      }

      return this.issuanceProfileRepository.findById(profileId);
    }

    const name = profileId.slice(0, separatorIndex);
    const version = profileId.slice(separatorIndex + 1);

    return this.issuanceProfileRepository.findByNameAndVersion(
      tenantId,
      name,
      version,
    );
  }

  private async resolveFromProfile(
    tenantId: string,
    profileId: string,
  ): Promise<ResolvedCredentialSource> {
    const profile = await this.findProfile(tenantId, profileId);

    // A cross-tenant profile and a missing one are indistinguishable 400s,
    // same as IssuanceProfileRepository.findById having no tenant filter of
    // its own.
    if (!profile || profile.tenantId !== tenantId) {
      throw new BadRequestException(
        `Issuance profile '${profileId}' was not found`,
      );
    }

    if (profile.status === IssuanceProfileStatus.DRAFT) {
      throw new BadRequestException(
        `Issuance profile '${profileId}' is not published`,
      );
    }

    if (profile.status === IssuanceProfileStatus.DEPRECATED) {
      throw new BadRequestException(
        `Issuance profile '${profileId}' has been deprecated`,
      );
    }

    // The profile denormalizes format/credential_definition_id, but
    // attribute validation needs the credential definition's own
    // schema_definition shape (attr_names/schema_name/schema_version), not
    // the profile's attribute_schema — see FormatValidator.validateAttributes.
    // A definition since deactivated (soft-delete) behind a still-published
    // profile is a request-input problem, not a server error.
    const credentialDefinition =
      await this.credentialDefinitionRepository.findById(
        profile.credentialDefinitionId,
      );

    if (!credentialDefinition || credentialDefinition.tenantId !== tenantId) {
      throw new BadRequestException(
        `Issuance profile '${profileId}' references a credential definition that is no longer active`,
      );
    }

    this.assertDefinitionReady(credentialDefinition);
    if (profile.connectorId !== credentialDefinition.connectorId) {
      throw new BadRequestException(
        'Profile connector does not own this credential definition',
      );
    }
    return {
      credentialDefinitionId: credentialDefinition.id,
      externalCredentialDefinitionId: credentialDefinition.externalId!,
      format: profile.format,
      connectorId: profile.connectorId ?? undefined,
      schemaDefinition: credentialDefinition.schemaDefinition,
      defaults: profile.defaults ?? {},
      issuanceProfileId: profile.id,
    };
  }

  /** Direct mode uses the definition's format and pinned connector. */
  private async resolveFromCredentialDefinition(
    tenantId: string,
    credentialDefinitionId: string,
  ): Promise<ResolvedCredentialSource> {
    const credentialDefinition =
      await this.credentialDefinitionRepository.findById(
        credentialDefinitionId,
      );

    if (!credentialDefinition || credentialDefinition.tenantId !== tenantId) {
      throw new NotFoundException(
        `Credential definition '${credentialDefinitionId}' was not found`,
      );
    }

    this.assertDefinitionReady(credentialDefinition);
    return {
      credentialDefinitionId: credentialDefinition.id,
      externalCredentialDefinitionId: credentialDefinition.externalId!,
      format: credentialDefinition.format,
      connectorId: credentialDefinition.connectorId ?? undefined,
      schemaDefinition: credentialDefinition.schemaDefinition,
      defaults: {},
      issuanceProfileId: null,
    };
  }

  private assertDefinitionReady(definition: CredentialDefinition): void {
    if (
      definition.registrationState !== 'ready' ||
      !definition.externalId ||
      !definition.connectorId
    ) {
      throw new BadRequestException(
        'Credential definition is not ready for issuance',
      );
    }
  }

  /**
   * A format the port layer does not know (no toPortCredentialFormat
   * mapping, e.g. today's SD-JWT/W3C VC entity values) is rejected
   * explicitly: AdapterRegistry.resolve() treats an undefined format as
   * "nothing to check", which would silently let the offer through without
   * ever validating connector/format compatibility.
   */
  private resolvePortFormat(
    format: CredentialDefinitionFormat,
  ): PortCredentialFormat {
    const portFormat = toPortCredentialFormat(format);

    if (!portFormat) {
      throw new BadRequestException(
        `Credential format '${format}' is not yet supported for issuance`,
      );
    }

    return portFormat;
  }

  /**
   * Mirrors CredentialDefinitionService.validateSchemaDefinition: formats
   * without a registered validator yet are accepted as-is.
   */
  private assertAttributesValid(
    format: PortCredentialFormat,
    schemaDefinition: Readonly<Record<string, unknown>>,
    attributes: readonly CredentialAttribute[],
  ): void {
    if (!this.formatValidatorRegistry.has(format)) {
      return;
    }

    const issues = this.formatValidatorRegistry
      .resolve(format)
      .validateAttributes(schemaDefinition, attributes);

    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Credential attributes failed format validation',
        issues,
      });
    }
  }

  private async resolveAdapter(
    tenantId: string,
    format: PortCredentialFormat,
    connectorId?: string,
  ): Promise<ResolvedAdapter> {
    try {
      return await this.adapterRegistry.resolve(tenantId, format, {
        connectorId,
      });
    } catch (error) {
      if (error instanceof AdapterError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  private toRequestBody(
    dto: OfferCredentialRequestDto,
  ): Record<string, unknown> {
    return {
      ...(dto.profileId !== undefined ? { profile_id: dto.profileId } : {}),
      ...(dto.credentialDefinitionId !== undefined
        ? { credential_definition_id: dto.credentialDefinitionId }
        : {}),
      credential: { credentialSubject: dto.credential.credentialSubject },
      delivery: {
        protocol: dto.delivery.protocol,
        connection_id: dto.delivery.connectionId,
      },
      ...(dto.options !== undefined
        ? { options: { auto_issue: dto.options.autoIssue ?? true } }
        : {}),
    };
  }

  /**
   * Calls the adapter and durably settles `operation`/`credential` off
   * PENDING/OFFERED. Both rows were just created inside `offer()`'s own
   * transaction, so from this point on they are handled the same as a
   * recovered in-flight pair in the accept/reject/revoke templates this
   * mirrors.
   */
  private async executeOffer(
    tenantId: string,
    operation: Operation,
    credential: Credential,
    resolvedAdapter: ResolvedAdapter,
    offerRequest: OfferCredentialRequest,
  ): Promise<Operation> {
    try {
      const exchange = await resolvedAdapter.adapter.offerCredential(
        resolvedAdapter.context,
        offerRequest,
      );

      const outcome = resolveProtocolOutcome(
        'issue_credential',
        exchange.state,
      ) ?? { operationState: OperationState.PROCESSING };
      const externalId = exchange.externalId ?? exchange.id;
      const result =
        outcome.operationState === OperationState.FAILED
          ? {
              code: 'OFFER_FAILED',
              message: exchange.error ?? 'Credential offer failed',
            }
          : outcome.operationState === OperationState.COMPLETED
            ? { ...exchange }
            : undefined;

      // Guarded and dispatched together in one transaction, same rationale
      // as the accept/reject/revoke templates: only the caller whose
      // transitionStateIfForward actually wins may enqueue webhook.dispatch
      // or apply the paired Credential write, and a webhook already racing
      // this same Operation (TOPIC_OPERATION_TYPES includes CREDENTIAL_OFFER
      // for issue_credential) is exactly what this guard protects against.
      const { current, won } = await this.dataSource.transaction(
        async (manager) => {
          if (operation.exchangeId) {
            await this.exchanges.observe(
              tenantId,
              resolvedAdapter.connector.id,
              externalId,
              exchange.state,
              manager,
              operation.exchangeId,
            );
          }
          const updatedOperation =
            await this.operationService.transitionStateIfForward(
              operation.id,
              outcome.operationState,
              operationStatesBelow(outcome.operationState),
              result,
              manager,
              externalId,
            );

          if (!updatedOperation) {
            const existing = await this.operationRepository.findById(
              operation.id,
              manager,
            );

            if (!existing) {
              throw new NotFoundException('Operation not found');
            }

            return { current: existing, won: false };
          }

          if (outcome.credentialState) {
            const credentialUpdated =
              await this.credentialRepository.updateStateIfForward(
                credential.id,
                tenantId,
                outcome.credentialState,
                credentialStatesBelow(outcome.credentialState),
                {
                  issuedAt:
                    outcome.credentialState === CredentialState.ISSUED
                      ? new Date()
                      : undefined,
                  externalId,
                },
                manager,
              );

            if (!credentialUpdated) {
              throw new Error(
                `Credential '${credential.id}' was not in an offerable state ` +
                  `despite Operation '${operation.id}' winning its own guard`,
              );
            }
          } else {
            // OFFERED is never a valid guarded-transition target (see
            // credential.repository.ts's setExternalId doc comment), so the
            // common "offer sent, still in flight" outcome persists
            // externalId this way instead.
            await this.credentialRepository.setExternalId(
              credential.id,
              tenantId,
              externalId,
              manager,
            );
          }

          if (
            outcome.operationState === OperationState.COMPLETED ||
            outcome.operationState === OperationState.FAILED
          ) {
            await this.jobsService.sendInTransaction(
              manager,
              JOB_QUEUES.WEBHOOK_DISPATCH,
              {
                tenantId,
                event: outcome.event ?? 'credential.offer.failed',
                resourceId: externalId,
                occurredAt: new Date().toISOString(),
              },
            );
          }

          return { current: updatedOperation, won: true };
        },
      );

      await this.emitAudit(tenantId, credential.id, current.state);

      if (won && outcome.event) {
        this.eventEmitter.emit(outcome.event, { tenantId, externalId });
      }

      return current;
    } catch (error) {
      if (!(error instanceof AdapterError)) {
        throw error;
      }

      this.logger.warn(
        `Credential offer failed for tenant '${tenantId}': ${error.message}`,
      );

      // Same race as the synchronous-completion path above: the protocol
      // worker cannot have raced this specific Operation yet (no externalId
      // was ever recorded for it to correlate against), but the guard is
      // kept for consistency with the accept/reject/revoke templates and in
      // case of a duplicate delivery of this same request.
      const current = await this.dataSource.transaction(async (manager) => {
        if (operation.exchangeId) {
          await manager.update(
            'credential_exchange',
            { id: operation.exchangeId, tenantId },
            { state: 'failed' },
          );
        }
        const failedOperation =
          await this.operationService.transitionStateIfForward(
            operation.id,
            OperationState.FAILED,
            operationStatesBelow(OperationState.FAILED),
            { code: error.code, message: error.message },
            manager,
          );

        if (!failedOperation) {
          const existing = await this.operationRepository.findById(
            operation.id,
            manager,
          );

          if (!existing) {
            throw new NotFoundException('Operation not found');
          }

          return existing;
        }

        const credentialFailed =
          await this.credentialRepository.updateStateIfForward(
            credential.id,
            tenantId,
            CredentialState.FAILED,
            credentialStatesBelow(CredentialState.FAILED),
            {},
            manager,
          );

        if (!credentialFailed) {
          throw new Error(
            `Credential '${credential.id}' was not in an offerable state ` +
              `despite Operation '${operation.id}' winning its own guard`,
          );
        }

        await this.jobsService.sendInTransaction(
          manager,
          JOB_QUEUES.WEBHOOK_DISPATCH,
          {
            tenantId,
            event: 'credential.offer.failed',
            resourceId: operation.id,
            occurredAt: new Date().toISOString(),
          },
        );

        return failedOperation;
      });

      await this.emitAudit(tenantId, credential.id, current.state);

      return current;
    }
  }

  private async emitAudit(
    tenantId: string,
    credentialId: string,
    state: OperationState,
  ): Promise<void> {
    await this.domainAudit.emit({
      tenantId,
      action: AuditAction.ISSUE,
      resourceType: 'credential',
      resourceId: credentialId,
      metadata: { state },
    });
  }
}
