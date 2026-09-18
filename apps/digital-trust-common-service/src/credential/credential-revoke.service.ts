import { AdapterError } from '@app/credential-ports';
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
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import {
  credentialStatesBelow,
  operationStatesBelow,
} from '../protocol-state-change/state-mapping';

import { Credential, CredentialState } from './credential.entity';
import { CredentialRepository } from './credential.repository';

/**
 * Credential formats whose adapters currently expose a revocation registry.
 * AnonCreds is the MVP format that supports revocation; the other formats
 * declared on `CredentialDefinitionFormat` (sd-jwt, mdl, w3c-vc) do not yet
 * have a revocation mechanism wired through the port layer, so a revoke
 * request against one of them is rejected up front (400) rather than
 * attempted and failing unpredictably at the adapter.
 */
const REVOCABLE_FORMATS: ReadonlySet<CredentialDefinitionFormat> = new Set([
  CredentialDefinitionFormat.ANONCREDS,
]);

/**
 * Backs POST /tenants/:tenantId/credentials/:credentialId/revoke.
 *
 * `credentialId` is the persisted Credential record id (contrast with the
 * accept/reject routes, which key off the Operation id) — see
 * `docs/openapi.yaml`.
 */
@Injectable()
export class CredentialRevokeService {
  private readonly logger = new Logger(CredentialRevokeService.name);

  public constructor(
    private readonly credentialRepository: CredentialRepository,
    private readonly operationRepository: OperationRepository,
    private readonly operationService: OperationService,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly domainAudit: DomainAuditService,
    private readonly jobsService: JobsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  public async revoke(
    tenantId: string,
    credentialId: string,
  ): Promise<Operation> {
    const credential = await this.credentialRepository.findByIdForTenant(
      credentialId,
      tenantId,
    );

    // A cross-tenant id and a missing one are indistinguishable 404s, same as
    // CredentialRepository.findByIdForTenant's own tenant-scoped WHERE.
    if (!credential) {
      throw new NotFoundException(`Credential '${credentialId}' was not found`);
    }

    if (!REVOCABLE_FORMATS.has(credential.format)) {
      throw new BadRequestException(
        `Credential format '${credential.format}' does not support revocation`,
      );
    }

    if (!credential.externalId) {
      throw new BadRequestException(
        `Credential '${credentialId}' has no adapter-assigned identifier to revoke`,
      );
    }

    const externalId = credential.externalId;

    // A read-then-create check is not an atomic claim: without it, a
    // concurrent call or a client retry would create a second
    // credential.revoke Operation for the same externalId, and the
    // protocol.state-change worker's newest-first externalId lookup would
    // only ever complete the newer one — leaving the older sibling
    // PENDING/PROCESSING forever and its poller waiting on an Operation
    // nothing will ever finish. Reusing an already in-flight revoke
    // Operation for this credential instead of creating a new one keeps
    // that correlation one-to-one, same rationale as the holder-action
    // pre-check in CredentialActionService.perform().
    const inFlight = await this.operationRepository.findByExternalIdForTenant(
      tenantId,
      externalId,
      [OPERATION_TYPE.CREDENTIAL_REVOKE],
    );

    if (inFlight) {
      // A PROCESSING row means a previous call already reached the adapter
      // and is either still waiting on it or racing the protocol worker to
      // settle it — returning it here is correct. A PENDING row instead
      // means createOperation persisted it durably but nothing ever reached
      // the adapter call, most likely a previous attempt that crashed in
      // that exact window. Nothing else ever advances a stuck PENDING row,
      // so retrying the adapter call against that same row is what actually
      // recovers it.
      if (inFlight.state === OperationState.PROCESSING) {
        return inFlight;
      }

      return this.executeRevoke(tenantId, credentialId, credential, inFlight);
    }

    // The check above is not an atomic claim: two concurrent requests can
    // both observe no in-flight row and both reach this insert. The
    // `uq_operation_inflight_revoke` partial unique index (see its
    // migration) is what actually enforces "at most one in-flight
    // credential.revoke Operation per tenant/externalId" — the loser's
    // INSERT fails with a unique violation (23505) rather than silently
    // creating the duplicate this check was meant to prevent.
    let operation: Operation;

    try {
      operation = await this.operationService.createOperation({
        tenantId,
        type: OPERATION_TYPE.CREDENTIAL_REVOKE,
        request: {
          method: 'POST',
          path: `${API_BASE_PATH}/tenants/${tenantId}/credentials/${credentialId}/revoke`,
          body: {},
        },
        externalId,
      });
    } catch (error) {
      const pgCode = (error as { driverError?: { code?: string } }).driverError
        ?.code;

      if (pgCode !== '23505') {
        throw error;
      }

      // Lost the race: a concurrent call already claimed the single
      // in-flight revoke slot this index allows for this credential.
      // Return that winner instead of surfacing the constraint violation.
      // findByExternalIdForTenant excludes terminal states and would miss a
      // winner that has already completed/failed by now —
      // findLatestByExternalIdAndTypeForTenant finds the winner regardless
      // of state.
      const winner =
        await this.operationRepository.findLatestByExternalIdAndTypeForTenant(
          tenantId,
          externalId,
          OPERATION_TYPE.CREDENTIAL_REVOKE,
        );

      if (!winner) {
        throw error;
      }

      // Same recovery as the pre-check above: a winner still PENDING never
      // reached the adapter call, whether that's this request's own crashed
      // prior attempt or the concurrent one that won the insert race just
      // now.
      if (winner.state === OperationState.PENDING) {
        return this.executeRevoke(tenantId, credentialId, credential, winner);
      }

      return winner;
    }

    return this.executeRevoke(tenantId, credentialId, credential, operation);
  }

  /**
   * Calls the adapter and durably settles `operation` off PENDING. Shared by
   * a freshly created operation and a durable PENDING one recovered from a
   * previous attempt (see revoke()) — from this point on the two are
   * indistinguishable.
   */
  private async executeRevoke(
    tenantId: string,
    credentialId: string,
    credential: Credential,
    operation: Operation,
  ): Promise<Operation> {
    // Validated by revoke() before it ever creates or looks up `operation`.
    const externalId = credential.externalId as string;

    try {
      const { adapter, context } = await this.adapterRegistry.resolve(
        tenantId,
        undefined,
        {
          connectorId: credential.connectorId,
        },
      );

      const result = await adapter.revoke(context, externalId);

      // RevocationPort exposes only a final boolean, with no intermediate
      // "pending ledger write" signal, so every resolved call is treated as
      // synchronous/completed. This is a documented limitation until the
      // port grows a pending state (see PR description).
      //
      // The protocol.state-change worker also correlates this same
      // `operation` by externalId (TOPIC_OPERATION_TYPES includes
      // CREDENTIAL_REVOKE for revocation_registry) and can win the race
      // while adapter.revoke() above is still in flight, transitioning
      // `operation` to COMPLETED or FAILED before this method resumes. A
      // plain transitionState/updateState here would regress an
      // already-completed operation back to failed, or overwrite an
      // already-revoked credential/operation and duplicate audit side
      // effects. transitionStateIfForward/updateStateIfForward guard the
      // writes with the same `WHERE state IN (...)` query the protocol
      // worker itself uses, so only the caller that actually wins applies
      // its outcome — a loss reports the operation's actual current state
      // instead.
      if (!result.revoked) {
        const current = await this.dataSource.transaction(async (manager) => {
          const failed = await this.operationService.transitionStateIfForward(
            operation.id,
            OperationState.FAILED,
            operationStatesBelow(OperationState.FAILED),
            {
              code: 'REVOCATION_FAILED',
              message: result.error ?? 'Revocation was not applied',
            },
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
              event: 'credential.revoke.failed',
              resourceId: externalId,
              occurredAt: new Date().toISOString(),
            },
          );

          return failed;
        });

        await this.emitAudit(tenantId, credentialId, current.state);

        return current;
      }

      const revokedAt = result.revokedAt
        ? new Date(result.revokedAt)
        : new Date();

      // Guarded and dispatched together in one transaction, same rationale
      // as the accept/reject path in CredentialActionService: only the
      // caller whose transitionStateIfForward actually wins may enqueue
      // webhook.dispatch, and the enqueue rolling back with the state write
      // on failure means a pg-boss insert failure can't leave the operation
      // durably COMPLETED with no corresponding notification.
      //
      // Operation is locked/updated before Credential here, same order as
      // ProtocolStateChangeService.process() (Operation outcome applied
      // before Credential outcome). A concurrent synchronous revoke and a
      // revocation_registry webhook for the same credential both touch
      // these two rows; locking them in opposite orders is exactly how two
      // transactions deadlock, each holding one row and waiting on the
      // other — Postgres would abort one with a deadlock error instead of
      // either side ever losing the guard cleanly.
      const { operation: current, won } = await this.dataSource.transaction(
        async (manager) => {
          const updated = await this.operationService.transitionStateIfForward(
            operation.id,
            OperationState.COMPLETED,
            operationStatesBelow(OperationState.COMPLETED),
            { ...result },
            manager,
          );

          if (!updated) {
            const existing = await this.operationRepository.findById(
              operation.id,
            );

            if (!existing) {
              throw new NotFoundException('Operation not found');
            }

            return { operation: existing, won: false };
          }

          // Checked, not discarded: if the credential is no longer in a
          // state this revoke can move forward from (already REVOKED by a
          // concurrent winner), the Operation write above must not commit
          // either — throwing here rolls it back too, since the Operation
          // has already won its own guard and can no longer be reported
          // back as a clean loss.
          const credentialUpdated =
            await this.credentialRepository.updateStateIfForward(
              credentialId,
              tenantId,
              CredentialState.REVOKED,
              credentialStatesBelow(CredentialState.REVOKED),
              { revokedAt },
              manager,
            );

          if (!credentialUpdated) {
            throw new Error(
              `Credential '${credentialId}' was not in a revocable state ` +
                `despite Operation '${operation.id}' winning its own guard`,
            );
          }

          await this.jobsService.sendInTransaction(
            manager,
            JOB_QUEUES.WEBHOOK_DISPATCH,
            {
              tenantId,
              event: 'credential.revoked',
              resourceId: externalId,
              occurredAt: new Date().toISOString(),
            },
          );

          return { operation: updated, won: true };
        },
      );

      await this.emitAudit(tenantId, credentialId, current.state);

      // In-process only, and only once the transition + durable enqueue
      // above have actually committed. Skipped on a lost race so the
      // protocol worker's own confirmation is the only thing that ever
      // emits credential.revoked for that outcome.
      if (won) {
        this.eventEmitter.emit('credential.revoked', {
          tenantId,
          externalId,
        });
      }

      return current;
    } catch (error) {
      if (!(error instanceof AdapterError)) {
        throw error;
      }

      this.logger.warn(
        `Credential revocation failed for credential '${credentialId}': ${error.message}`,
      );

      // Same race as the synchronous-completion path above: the protocol
      // worker may have already completed (or failed) this operation while
      // the adapter call was rejecting here, so this write is guarded too.
      // On a loss, report the operation's actual current state instead of
      // regressing it to FAILED, and skip the enqueue below.
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
            event: 'credential.revoke.failed',
            resourceId: externalId,
            occurredAt: new Date().toISOString(),
          },
        );

        return failed;
      });

      await this.emitAudit(tenantId, credentialId, current.state);

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
      action: AuditAction.REVOKE,
      resourceType: 'credential',
      resourceId: credentialId,
      metadata: { state },
    });
  }
}
