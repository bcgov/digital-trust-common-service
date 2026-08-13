import type { Adapter, AdapterPayload } from 'oidc-provider';
import type { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { OidcModel } from '../entities/oidc-model.entity';

/**
 * Generic TypeORM-backed adapter for oidc-provider's session/grant model
 * kinds (Session, AuthorizationCode, AccessToken, RefreshToken, DeviceCode,
 * Interaction, ReplayDetection, PushedAuthorizationRequest, etc). One
 * instance is constructed per model name by `OidcAdapterFactory`.
 *
 * Client credentials are handled separately by `OidcClientAdapter`.
 */
export class OidcModelAdapter implements Adapter {
  public constructor(
    private readonly modelName: string,
    private readonly repository: Repository<OidcModel>,
  ) {}

  public async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number,
  ): Promise<void> {
    const expiresAt =
      expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;

    // oidc-provider can re-upsert the same (modelName, oidcId) pair from
    // concurrent requests (e.g. Session uid). A find-then-save would race:
    // both calls see no existing row and both insert, violating
    // uq_oidc_model_name_id. `repository.upsert` performs a single atomic
    // `INSERT ... ON CONFLICT DO UPDATE`, so the second writer updates
    // instead of throwing. All columns are passed explicitly (including
    // `consumedAt: null`) because upsert() does not run @BeforeUpdate hooks
    // or reset omitted columns on the update path.
    await this.repository.upsert(
      {
        modelName: this.modelName,
        oidcId: id,
        payload: payload as unknown as Record<string, unknown>,
        grantId: payload.grantId ?? null,
        userCode: payload.userCode ?? null,
        uid: payload.uid ?? null,
        // Promoted out of the JSONB payload so AU-08's session cap and
        // force-logout can look records up by user without scanning.
        accountId: payload.accountId ?? null,
        expiresAt,
        consumedAt: null,
      } as QueryDeepPartialEntity<OidcModel>,
      { conflictPaths: ['modelName', 'oidcId'] },
    );
  }

  public async find(id: string): Promise<AdapterPayload | undefined> {
    const row = await this.repository.findOne({
      where: { modelName: this.modelName, oidcId: id },
    });

    return this.toPayloadIfActive(row);
  }

  public async findByUserCode(
    userCode: string,
  ): Promise<AdapterPayload | undefined> {
    const row = await this.repository.findOne({
      where: { modelName: this.modelName, userCode },
    });

    return this.toPayloadIfActive(row);
  }

  public async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    const row = await this.repository.findOne({
      where: { modelName: this.modelName, uid },
    });

    return this.toPayloadIfActive(row);
  }

  public async consume(id: string): Promise<void> {
    await this.repository.update(
      { modelName: this.modelName, oidcId: id },
      { consumedAt: new Date() },
    );
  }

  public async destroy(id: string): Promise<void> {
    await this.repository.delete({ modelName: this.modelName, oidcId: id });
  }

  public async revokeByGrantId(grantId: string): Promise<void> {
    await this.repository.delete({ modelName: this.modelName, grantId });
  }

  private toPayloadIfActive(row: OidcModel | null): AdapterPayload | undefined {
    if (!row) {
      return undefined;
    }

    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      return undefined;
    }

    const payload = { ...(row.payload as AdapterPayload) };

    if (row.consumedAt) {
      payload.consumed = Math.floor(row.consumedAt.getTime() / 1000);
    }

    return payload;
  }
}
