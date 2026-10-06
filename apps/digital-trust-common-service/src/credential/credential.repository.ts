import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { Credential, CredentialState } from './credential.entity';

@Injectable()
export class CredentialRepository {
  public constructor(
    @InjectRepository(Credential)
    private readonly repository: Repository<Credential>,
  ) {}

  public async create(
    data: Partial<Credential>,
    manager?: EntityManager,
  ): Promise<Credential> {
    const entity = this.repository.create(data);
    return manager
      ? await manager.save(entity)
      : await this.repository.save(entity);
  }

  public async findById(id: string): Promise<Credential | null> {
    return await this.repository.findOne({ where: { id } });
  }

  public async findByTenant(tenantId: string): Promise<Credential[]> {
    return await this.repository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  public async findByExternalId(
    tenantId: string,
    externalId: string,
  ): Promise<Credential | null> {
    return await this.repository.findOne({
      where: { tenantId, externalId },
    });
  }

  /**
   * Tenant-scoped lookup backing the revoke endpoint. The tenant filter
   * lives in the WHERE clause rather than a post-load comparison so another
   * tenant's credential id is indistinguishable from a missing row, matching
   * OperationRepository.findByIdForTenant.
   */
  public async findByIdForTenant(
    id: string,
    tenantId: string,
  ): Promise<Credential | null> {
    return await this.repository.findOne({ where: { id, tenantId } });
  }

  public async findByProfile(
    tenantId: string,
    issuanceProfileId: string,
  ): Promise<Credential[]> {
    return await this.repository.find({
      where: { tenantId, issuanceProfileId },
      order: { createdAt: 'DESC' },
    });
  }

  public async updateState(
    id: string,
    state: CredentialState,
    timestamps?: { issuedAt?: Date; revokedAt?: Date },
  ): Promise<void> {
    await this.repository.update(id, {
      state,
      ...(timestamps?.issuedAt !== undefined
        ? { issuedAt: timestamps.issuedAt }
        : {}),
      ...(timestamps?.revokedAt !== undefined
        ? { revokedAt: timestamps.revokedAt }
        : {}),
    });
  }

  /**
   * Guarded counterpart to updateState for callers where the same logical
   * transition can be delivered more than once concurrently (the
   * protocol.state-change worker, given pg-boss's at-least-once delivery).
   * `fromStates` — the full set of states a forward move into `state` could
   * legitimately come from, via state-mapping.ts's `credentialStatesBelow()`
   * — is enforced by the database at write time (`WHERE state IN (...)`),
   * not by a value the caller read moments earlier. `tenantId` is also part
   * of that WHERE clause: this is a system-triggered write with no
   * AuthContext, so the guard must not rely solely on the caller having
   * resolved `id` through a tenant-scoped read moments earlier — the
   * mutation itself enforces the tenant boundary. Returns whether this
   * call's UPDATE actually matched a row; a duplicate or losing delivery
   * (or a cross-tenant id) gets `false` and must not repeat any side
   * effects.
   *
   * `externalId`, when provided, is written atomically with the state in
   * the same guarded UPDATE — see `setExternalId` below for the case where
   * the target state is `OFFERED` itself (never a valid transition target,
   * so this guard can't be used to persist externalId there).
   */
  public async updateStateIfForward(
    id: string,
    tenantId: string,
    state: CredentialState,
    fromStates: CredentialState[],
    timestamps?: {
      issuedAt?: Date;
      revokedAt?: Date;
      externalId?: string | null;
    },
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await (manager ?? this.repository.manager).update(
      Credential,
      { id, tenantId, state: In(fromStates) },
      {
        state,
        ...(timestamps?.issuedAt !== undefined
          ? { issuedAt: timestamps.issuedAt }
          : {}),
        ...(timestamps?.revokedAt !== undefined
          ? { revokedAt: timestamps.revokedAt }
          : {}),
        ...(timestamps?.externalId !== undefined
          ? { externalId: timestamps.externalId }
          : {}),
      },
    );

    return (result.affected ?? 0) > 0;
  }

  /**
   * Sets externalId without a state guard. `CredentialState.OFFERED` is
   * never a valid *target* of a guarded transition (it's the row's initial
   * state only — see state-mapping.ts's `CREDENTIAL_ALLOWED_FROM_STATES`),
   * so the common "offer sent, still in flight" outcome (no credential
   * state change yet) has no guarded-transition call to piggy-back this
   * write onto, unlike updateStateIfForward above. The back-end agent's
   * exchange id still needs to be durably recorded here so the
   * protocol.state-change worker can later correlate a webhook back to this
   * credential (see `CredentialRepository.findByExternalId`). `tenantId`
   * scopes the WHERE clause for the same reason as updateStateIfForward: a
   * system-triggered write with no AuthContext must not rely solely on a
   * tenant-scoped read moments earlier.
   */
  public async setExternalId(
    id: string,
    tenantId: string,
    externalId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await (manager ?? this.repository.manager).update(
      Credential,
      { id, tenantId },
      { externalId },
    );
  }

  /**
   * Used to block connector deletion when credential records still reference
   * it (mirrors the `fk_credential_connector` ON DELETE RESTRICT constraint,
   * but surfaces as a clean check before the DB rejects the delete).
   */
  public async existsByConnectorId(connectorId: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { connectorId },
    });
    return count > 0;
  }
}
