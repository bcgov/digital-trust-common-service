import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OidcUpstreamSession } from './oidc-upstream-session.entity';

type OidcUpstreamSessionWriteInput = Pick<
  OidcUpstreamSession,
  | 'oidcModelId'
  | 'oidcSessionUid'
  | 'tenantUserId'
  | 'upstreamSubject'
  | 'upstreamIdToken'
  | 'expiresAt'
>;

@Injectable()
export class OidcUpstreamSessionRepository {
  public constructor(
    @InjectRepository(OidcUpstreamSession)
    private readonly repository: Repository<OidcUpstreamSession>,
  ) {}

  public async create(
    session: Partial<OidcUpstreamSession>,
  ): Promise<OidcUpstreamSession> {
    const entity = this.repository.create(session);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<OidcUpstreamSession | null> {
    return await this.repository.findOne({
      where: { id },
    });
  }

  public async findByOidcModelId(
    oidcModelId: string,
  ): Promise<OidcUpstreamSession | null> {
    return await this.repository.findOne({
      where: { oidcModelId },
    });
  }

  public async findByOidcSessionUid(
    oidcSessionUid: string,
  ): Promise<OidcUpstreamSession | null> {
    return await this.repository.findOne({
      where: { oidcSessionUid },
    });
  }

  public async findPendingByOidcSessionUid(
    oidcSessionUid: string,
  ): Promise<OidcUpstreamSession | null> {
    return await this.repository
      .createQueryBuilder('session')
      .where('session.oidcSessionUid = :oidcSessionUid', { oidcSessionUid })
      .andWhere('session.oidcModelId IS NULL')
      .getOne();
  }

  public async findLatestPendingByTenantUserId(
    tenantUserId: string,
  ): Promise<OidcUpstreamSession | null> {
    return await this.repository
      .createQueryBuilder('session')
      .where('session.tenantUserId = :tenantUserId', { tenantUserId })
      .andWhere('session.oidcModelId IS NULL')
      .andWhere('(session.expiresAt IS NULL OR session.expiresAt > NOW())')
      .orderBy('session.createdAt', 'DESC')
      .getOne();
  }

  public async upsertByOidcModelId(
    session: OidcUpstreamSessionWriteInput,
  ): Promise<OidcUpstreamSession> {
    if (!session.oidcModelId) {
      throw new Error('oidcModelId is required for upsertByOidcModelId');
    }

    await this.repository.upsert(session, ['oidcModelId']);

    const saved = await this.repository.findOne({
      where: { oidcModelId: session.oidcModelId },
    });

    if (!saved) {
      throw new Error(
        `Unable to load upserted upstream session for oidcModelId ${session.oidcModelId}`,
      );
    }

    return saved;
  }

  public async upsertPendingByOidcSessionUid(
    session: OidcUpstreamSessionWriteInput,
  ): Promise<OidcUpstreamSession> {
    if (!session.oidcSessionUid) {
      throw new Error(
        'oidcSessionUid is required for upsertPendingByOidcSessionUid',
      );
    }

    await this.repository.upsert(
      {
        ...session,
        oidcModelId: null,
      },
      ['oidcSessionUid'],
    );

    const saved = await this.repository.findOne({
      where: { oidcSessionUid: session.oidcSessionUid },
    });

    if (!saved) {
      throw new Error(
        `Unable to load upserted upstream session for oidcSessionUid ${session.oidcSessionUid}`,
      );
    }

    return saved;
  }

  public async createPending(
    session: Omit<
      OidcUpstreamSessionWriteInput,
      'oidcModelId' | 'oidcSessionUid'
    >,
  ): Promise<OidcUpstreamSession> {
    return await this.create({
      ...session,
      oidcModelId: null,
      oidcSessionUid: null,
    });
  }

  public async findExpiredSessions(): Promise<OidcUpstreamSession[]> {
    return await this.repository
      .createQueryBuilder('session')
      .where('session.expiresAt IS NOT NULL')
      .andWhere('session.expiresAt < NOW()')
      .getMany();
  }

  /**
   * Deletes expired pending sessions (oidcModelId IS NULL) in a bounded batch.
   * These records accumulate when finalization fails after callback staging and
   * cannot be cascade-deleted by oidc_model cleanup.
   */
  public async deleteExpiredPendingBatch(limit: number): Promise<number> {
    const limitedRows = await this.repository
      .createQueryBuilder('session')
      .select('session.id')
      .where('session.oidcModelId IS NULL')
      .andWhere('session.expiresAt IS NOT NULL')
      .andWhere('session.expiresAt < NOW()')
      .orderBy('session.createdAt', 'ASC')
      .limit(Math.max(1, Math.floor(limit)))
      .getMany();

    if (limitedRows.length === 0) {
      return 0;
    }

    const ids = limitedRows.map((row) => row.id);
    const result = await this.repository.delete(ids);
    return result.affected ?? 0;
  }

  public async update(
    session: OidcUpstreamSession,
  ): Promise<OidcUpstreamSession> {
    return await this.repository.save(session);
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  public async deleteByOidcModelId(oidcModelId: string): Promise<void> {
    await this.repository.delete({ oidcModelId });
  }
}
