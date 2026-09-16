import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { Credential, CredentialState } from './credential.entity';
import { CredentialRepository } from './credential.repository';

describe('CredentialRepository', () => {
  let repository: CredentialRepository;
  let mockRepo: jest.Mocked<Partial<Repository<Credential>>>;
  let mockManagerUpdate: jest.Mock;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      manager: {
        update: (mockManagerUpdate = jest.fn()),
      } as unknown as Repository<Credential>['manager'],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialRepository,
        {
          provide: getRepositoryToken(Credential),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(CredentialRepository);
  });

  it('create persists a new credential', async () => {
    const entity = { id: 'cred-1' } as Credential;
    (mockRepo.create as jest.Mock).mockReturnValue(entity);
    (mockRepo.save as jest.Mock).mockResolvedValue(entity);

    await expect(
      repository.create({ tenantId: 't1', operationId: 'op-1' }),
    ).resolves.toBe(entity);
    expect(mockRepo.create).toHaveBeenCalledWith({
      tenantId: 't1',
      operationId: 'op-1',
    });
    expect(mockRepo.save).toHaveBeenCalledWith(entity);
  });

  it('findById queries by id', async () => {
    await repository.findById('cred-1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'cred-1' },
    });
  });

  it('findByTenant orders by createdAt desc', async () => {
    await repository.findByTenant('t1');
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      order: { createdAt: 'DESC' },
    });
  });

  it('findByExternalId queries tenant + externalId', async () => {
    await repository.findByExternalId('t1', 'ext-1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 't1', externalId: 'ext-1' },
    });
  });

  it('findByIdForTenant queries tenant + id', async () => {
    await repository.findByIdForTenant('cred-1', 't1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'cred-1', tenantId: 't1' },
    });
  });

  it('findByProfile filters by issuance profile', async () => {
    await repository.findByProfile('t1', 'ip-1');
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1', issuanceProfileId: 'ip-1' },
      order: { createdAt: 'DESC' },
    });
  });

  it('updateState updates state only', async () => {
    await repository.updateState('cred-1', CredentialState.ISSUED);
    expect(mockRepo.update).toHaveBeenCalledWith('cred-1', {
      state: CredentialState.ISSUED,
    });
  });

  it('updateState includes issuedAt / revokedAt when provided', async () => {
    const issuedAt = new Date('2026-07-01T00:00:00.000Z');
    const revokedAt = new Date('2026-07-02T00:00:00.000Z');

    await repository.updateState('cred-1', CredentialState.REVOKED, {
      issuedAt,
      revokedAt,
    });

    expect(mockRepo.update).toHaveBeenCalledWith('cred-1', {
      state: CredentialState.REVOKED,
      issuedAt,
      revokedAt,
    });
  });

  describe('updateStateIfForward', () => {
    it('updates via a guarded write scoped to the given tenant and prior states', async () => {
      mockManagerUpdate.mockResolvedValue({ affected: 1 });
      const issuedAt = new Date('2026-07-01T00:00:00.000Z');

      const won = await repository.updateStateIfForward(
        'cred-1',
        't1',
        CredentialState.ISSUED,
        [CredentialState.OFFERED],
        { issuedAt },
      );

      expect(mockManagerUpdate).toHaveBeenCalledWith(
        Credential,
        {
          id: 'cred-1',
          tenantId: 't1',
          state: In([CredentialState.OFFERED]),
        },
        { state: CredentialState.ISSUED, issuedAt },
      );
      expect(won).toBe(true);
    });

    it('returns false when no row matched (already transitioned by another caller, or a cross-tenant id)', async () => {
      mockManagerUpdate.mockResolvedValue({ affected: 0 });

      const won = await repository.updateStateIfForward(
        'cred-1',
        't1',
        CredentialState.ISSUED,
        [CredentialState.OFFERED],
      );

      expect(won).toBe(false);
    });

    it('runs the update through the given manager, e.g. inside a transaction', async () => {
      const txUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const txManager = { update: txUpdate } as unknown as EntityManager;
      const issuedAt = new Date('2026-07-01T00:00:00.000Z');

      const won = await repository.updateStateIfForward(
        'cred-1',
        't1',
        CredentialState.ISSUED,
        [CredentialState.OFFERED],
        { issuedAt },
        txManager,
      );

      expect(txUpdate).toHaveBeenCalledWith(
        Credential,
        {
          id: 'cred-1',
          tenantId: 't1',
          state: In([CredentialState.OFFERED]),
        },
        { state: CredentialState.ISSUED, issuedAt },
      );
      expect(mockManagerUpdate).not.toHaveBeenCalled();
      expect(won).toBe(true);
    });
  });

  it('existsByConnectorId returns true when at least one credential references the connector', async () => {
    (mockRepo.count as jest.Mock).mockResolvedValue(2);

    await expect(repository.existsByConnectorId('connector-1')).resolves.toBe(
      true,
    );
    expect(mockRepo.count).toHaveBeenCalledWith({
      where: { connectorId: 'connector-1' },
    });
  });

  it('existsByConnectorId returns false when no credential references the connector', async () => {
    (mockRepo.count as jest.Mock).mockResolvedValue(0);

    await expect(repository.existsByConnectorId('connector-1')).resolves.toBe(
      false,
    );
  });
});
