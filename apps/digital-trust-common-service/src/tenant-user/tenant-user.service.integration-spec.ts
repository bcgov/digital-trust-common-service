import { randomUUID } from 'crypto';

import { PgBossService } from '@app/pg-boss';
import { ConflictException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AppModule } from '../app.module';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { Tenant } from '../tenant/tenant.entity';

import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';
import { TenantUserModule } from './tenant-user.module';
import { TenantUserRepository } from './tenant-user.repository';
import { TenantUserService } from './tenant-user.service';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

describe('TenantUserService administrator safeguards (integration)', () => {
  let app: INestApplication;
  let tenantRepository: Repository<Tenant>;
  let tenantUserEntityRepository: Repository<TenantUser>;
  let tenantUserRepository: TenantUserRepository;
  let tenantUserService: TenantUserService;
  let tenantId: string;
  let administratorIds: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
        stop: jest.fn().mockResolvedValue(undefined),
        isRunning: jest.fn().mockReturnValue(true),
      })
      .overrideProvider(DomainAuditService)
      .useValue({ emit: jest.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    tenantRepository = moduleFixture.get(getRepositoryToken(Tenant));
    tenantUserEntityRepository = moduleFixture.get(
      getRepositoryToken(TenantUser),
    );
    const tenantUserModule = moduleFixture.select(TenantUserModule);
    tenantUserRepository = tenantUserModule.get(TenantUserRepository, {
      strict: true,
    });
    tenantUserService = tenantUserModule.get(TenantUserService, {
      strict: true,
    });
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const tenant = await tenantRepository.save(
      tenantRepository.create({
        name: `Administrator safeguard ${randomUUID()}`,
        slug: `administrator-safeguard-${randomUUID()}`,
        config: {},
      }),
    );
    tenantId = tenant.id;

    const administrators = await tenantUserEntityRepository.save(
      [TenantUserRole.ADMIN, TenantUserRole.OWNER].map((role) =>
        tenantUserEntityRepository.create({
          tenantId,
          email: `administrator-${randomUUID()}@example.test`,
          role,
          status: TenantUserStatus.ACTIVE,
        }),
      ),
    );
    administratorIds = administrators.map(({ id }) => id);
  });

  afterEach(async () => {
    await tenantUserEntityRepository.delete({ tenantId });
    await tenantRepository.delete({ id: tenantId });
  });

  it('serializes concurrent demotion and removal of the final administrators', async () => {
    const originalCount =
      tenantUserRepository.countActiveAdministratorsByTenant.bind(
        tenantUserRepository,
      );
    let countCalls = 0;
    let releaseFirstCount: () => void = () => {};
    let signalFirstCount: () => void = () => {};
    const firstCountReached = new Promise<void>((resolve) => {
      signalFirstCount = resolve;
    });
    const releaseGate = new Promise<void>((resolve) => {
      releaseFirstCount = resolve;
    });

    tenantUserRepository.countActiveAdministratorsByTenant = async (
      id: string,
      manager?: EntityManager,
    ) => {
      const count = await originalCount(id, manager);
      countCalls += 1;

      if (countCalls === 1) {
        signalFirstCount();
        await releaseGate;
      }

      return count;
    };

    try {
      const demotion = tenantUserService.update(tenantId, administratorIds[0], {
        role: TenantUserRole.MEMBER,
      });
      const demotionOutcome = demotion.then(
        () => ({ status: 'fulfilled' as const }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );
      const firstCountOutcome = await Promise.race([
        firstCountReached.then(() => ({ status: 'count' as const })),
        demotionOutcome,
      ]);

      if (firstCountOutcome.status === 'rejected') {
        throw firstCountOutcome.reason;
      }
      if (firstCountOutcome.status === 'fulfilled') {
        throw new Error('Demotion completed before the administrator count.');
      }

      const removal = tenantUserService.delete(tenantId, administratorIds[1]);
      const outcomesPromise = Promise.allSettled([demotion, removal]);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(countCalls).toBe(1);

      releaseFirstCount();
      const outcomes = await outcomesPromise;

      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      const rejectedOutcomes = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      );
      expect(rejectedOutcomes).toHaveLength(1);
      expect(rejectedOutcomes[0]?.reason).toBeInstanceOf(ConflictException);
      await expect(
        tenantUserRepository.countActiveAdministratorsByTenant(tenantId),
      ).resolves.toBe(1);
    } finally {
      releaseFirstCount();
      tenantUserRepository.countActiveAdministratorsByTenant = originalCount;
    }
  }, 30000);
});
