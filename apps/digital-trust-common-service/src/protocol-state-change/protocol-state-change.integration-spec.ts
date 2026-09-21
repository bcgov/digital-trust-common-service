import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Job } from 'pg-boss';
import { Repository } from 'typeorm';

import { AppModule } from '../app.module';
import { ConnectorType } from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { Credential, CredentialState } from '../credential/credential.entity';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import { Tenant } from '../tenant/tenant.entity';

import type { ProtocolStateChangeJobData } from './protocol-state-change.worker';
import { ProtocolStateChangeWorker } from './protocol-state-change.worker';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

/**
 * `protocol-state-change.service.spec.ts` mocks every repository/service
 * collaborator, so it doesn't prove the real Operation -> Credential
 * correlation, the forward-only state guards, or tenant scoping actually
 * compose against a real Postgres instance. This seeds real rows and drives
 * the worker end to end, the same gap `tenant-status-change.integration-spec.ts`
 * closes for its own cascade.
 */
describe('ProtocolStateChange worker (integration)', () => {
  let app: INestApplication;
  let worker: ProtocolStateChangeWorker;
  let operationService: OperationService;
  let operationRepository: OperationRepository;
  let tenantRepo: Repository<Tenant>;
  let connectorCredentialRepo: Repository<ConnectorCredential>;
  let credentialRepo: Repository<Credential>;
  let operationRepo: Repository<Operation>;

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
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    worker = moduleFixture.get(ProtocolStateChangeWorker);
    operationService = moduleFixture.get(OperationService);
    operationRepository = moduleFixture.get(OperationRepository);
    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    connectorCredentialRepo = moduleFixture.get(
      getRepositoryToken(ConnectorCredential),
    );
    credentialRepo = moduleFixture.get(getRepositoryToken(Credential));
    operationRepo = moduleFixture.get(getRepositoryToken(Operation));
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  async function seedTenant(label: string): Promise<Tenant> {
    return tenantRepo.save(
      tenantRepo.create({
        name: `Protocol State Change Tenant ${label}`,
        slug: `psc-tenant-${label}-${Math.random().toString(36).slice(2)}`,
      }),
    );
  }

  async function seedConnector(tenantId: string): Promise<ConnectorCredential> {
    return connectorCredentialRepo.save(
      connectorCredentialRepo.create({
        tenantId,
        connectorType: ConnectorType.TRACTION,
        credentialsEncrypted: Buffer.from('encrypted'),
        endpointUrl: 'https://traction.example.test',
        active: true,
        keyVersion: 1,
      }),
    );
  }

  async function seedOfferOperationAndCredential(
    tenantId: string,
    connectorId: string,
    externalId: string,
  ): Promise<{ operation: Operation; credential: Credential }> {
    const operation = await operationService.createOperation({
      tenantId,
      type: OPERATION_TYPE.CREDENTIAL_OFFER,
      request: { method: 'POST', path: '/x', body: {} },
      externalId,
    });

    const credential = await credentialRepo.save(
      credentialRepo.create({
        tenantId,
        connectorId,
        operationId: operation.id,
        externalId,
        format: CredentialDefinitionFormat.ANONCREDS,
        state: CredentialState.OFFERED,
      }),
    );

    return { operation, credential };
  }

  async function cleanupTenant(tenantId: string): Promise<void> {
    await credentialRepo.delete({ tenantId });
    await operationRepo.delete({ tenantId });
    await connectorCredentialRepo.delete({ tenantId });
    await tenantRepo.delete({ id: tenantId });
  }

  function jobFor(
    data: ProtocolStateChangeJobData,
  ): Job<ProtocolStateChangeJobData> {
    return {
      id: `job-${Math.random().toString(36).slice(2)}`,
      data,
    } as Job<ProtocolStateChangeJobData>;
  }

  it('completes the Operation and issues the Credential on credential_issued', async () => {
    const tenant = await seedTenant('issue');
    const connector = await seedConnector(tenant.id);
    const externalId = `ext-${Math.random().toString(36).slice(2)}`;
    const { operation, credential } = await seedOfferOperationAndCredential(
      tenant.id,
      connector.id,
      externalId,
    );

    try {
      await worker.handle(
        jobFor({
          tenantId: tenant.id,
          topic: 'issue_credential',
          externalId,
          protocolState: 'credential_issued',
          payload: { credential_exchange_id: externalId },
        }),
      );

      const updatedOperation = await operationRepository.findByIdForTenant(
        operation.id,
        tenant.id,
      );
      const updatedCredential = await credentialRepo.findOne({
        where: { id: credential.id },
      });

      expect(updatedOperation?.state).toBe(OperationState.COMPLETED);
      expect(updatedOperation?.result).toEqual({
        credential_exchange_id: externalId,
      });
      expect(updatedCredential?.state).toBe(CredentialState.ISSUED);
      expect(updatedCredential?.issuedAt).toBeTruthy();
    } finally {
      await cleanupTenant(tenant.id);
    }
  });

  it('is a no-op when no Operation matches the externalId', async () => {
    const tenant = await seedTenant('no-match');

    try {
      await expect(
        worker.handle(
          jobFor({
            tenantId: tenant.id,
            topic: 'issue_credential',
            externalId: 'unknown-exchange',
            protocolState: 'credential_issued',
            payload: { credential_exchange_id: 'unknown-exchange' },
          }),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await cleanupTenant(tenant.id);
    }
  });

  it('does not transition another tenant sharing the same externalId', async () => {
    const tenantA = await seedTenant('cross-a');
    const tenantB = await seedTenant('cross-b');
    const connectorA = await seedConnector(tenantA.id);
    const connectorB = await seedConnector(tenantB.id);
    const sharedExternalId = `shared-${Math.random().toString(36).slice(2)}`;

    const { operation: operationA } = await seedOfferOperationAndCredential(
      tenantA.id,
      connectorA.id,
      sharedExternalId,
    );
    const { operation: operationB, credential: credentialB } =
      await seedOfferOperationAndCredential(
        tenantB.id,
        connectorB.id,
        sharedExternalId,
      );

    try {
      await worker.handle(
        jobFor({
          tenantId: tenantA.id,
          topic: 'issue_credential',
          externalId: sharedExternalId,
          protocolState: 'credential_issued',
          payload: { credential_exchange_id: sharedExternalId },
        }),
      );

      const updatedOperationA = await operationRepository.findByIdForTenant(
        operationA.id,
        tenantA.id,
      );
      const updatedOperationB = await operationRepository.findByIdForTenant(
        operationB.id,
        tenantB.id,
      );
      const updatedCredentialB = await credentialRepo.findOne({
        where: { id: credentialB.id },
      });

      expect(updatedOperationA?.state).toBe(OperationState.COMPLETED);
      expect(updatedOperationB?.state).toBe(OperationState.PENDING);
      expect(updatedCredentialB?.state).toBe(CredentialState.OFFERED);
    } finally {
      await cleanupTenant(tenantA.id);
      await cleanupTenant(tenantB.id);
    }
  });

  it('does not regress an already-completed Operation on a redelivered webhook', async () => {
    const tenant = await seedTenant('redelivery');
    const connector = await seedConnector(tenant.id);
    const externalId = `ext-${Math.random().toString(36).slice(2)}`;
    const { operation } = await seedOfferOperationAndCredential(
      tenant.id,
      connector.id,
      externalId,
    );

    const data: ProtocolStateChangeJobData = {
      tenantId: tenant.id,
      topic: 'issue_credential',
      externalId,
      protocolState: 'credential_issued',
      payload: { credential_exchange_id: externalId },
    };

    try {
      await worker.handle(jobFor(data));
      const firstCompletion = await operationRepository.findByIdForTenant(
        operation.id,
        tenant.id,
      );

      // Redelivered by pg-boss's at-least-once semantics.
      await worker.handle(jobFor(data));
      const secondDelivery = await operationRepository.findByIdForTenant(
        operation.id,
        tenant.id,
      );

      expect(firstCompletion?.state).toBe(OperationState.COMPLETED);
      expect(secondDelivery?.updatedAt.getTime()).toBe(
        firstCompletion?.updatedAt.getTime(),
      );
    } finally {
      await cleanupTenant(tenant.id);
    }
  });
});
