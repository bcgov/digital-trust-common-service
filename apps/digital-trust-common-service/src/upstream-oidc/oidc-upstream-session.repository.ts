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
