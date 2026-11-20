import { randomBytes, randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { WebhookRegistration } from './webhook-registration.entity';
import { WebhookEvent } from './webhook-registration.enums';
import { WebhookRegistrationRepository } from './webhook-registration.repository';

describe('WebhookRegistrationRepository', () => {
  const tenantId = randomUUID();
  const id = randomUUID();
  const repository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  let registrations: WebhookRegistrationRepository;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        WebhookRegistrationRepository,
        {
          provide: getRepositoryToken(WebhookRegistration),
          useValue: repository,
        },
      ],
    }).compile();
    registrations = module.get(WebhookRegistrationRepository);
  });

  it('creates a registration for the specified tenant', async () => {
    const data = {
      endpointUrl: 'https://example.com/webhooks',
      events: [WebhookEvent.CREDENTIAL_ISSUED],
      credentialsEncrypted: randomBytes(64),
      keyVersion: 1,
    };
    const registration = Object.assign(new WebhookRegistration(), {
      ...data,
      tenantId,
      id,
    });
    repository.create.mockReturnValue(registration);
    repository.save.mockResolvedValue(registration);

    await expect(registrations.create(tenantId, data)).resolves.toBe(
      registration,
    );
    expect(repository.create).toHaveBeenCalledWith({ ...data, tenantId });
    expect(repository.save).toHaveBeenCalledWith(registration);
  });

  it('lists only the requested tenant in stable creation order', async () => {
    repository.find.mockResolvedValue([]);

    await expect(registrations.findByTenant(tenantId)).resolves.toEqual([]);
    expect(repository.find).toHaveBeenCalledWith({
      where: { tenantId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  });

  it('limits dispatch lookups to active registrations in the tenant', async () => {
    repository.find.mockResolvedValue([]);

    await registrations.findActiveByTenant(tenantId);

    expect(repository.find).toHaveBeenCalledWith({
      where: { tenantId, active: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  });

  it('loads encrypted signing credentials only for active registrations in the tenant', async () => {
    const queryBuilder = {
      addSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    for (const method of [
      queryBuilder.addSelect,
      queryBuilder.where,
      queryBuilder.andWhere,
      queryBuilder.orderBy,
      queryBuilder.addOrderBy,
    ]) {
      method.mockReturnValue(queryBuilder);
    }
    repository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(registrations.findActiveForDispatch(tenantId)).resolves.toEqual(
      [],
    );

    expect(repository.createQueryBuilder).toHaveBeenCalledWith('registration');
    expect(queryBuilder.addSelect).toHaveBeenCalledWith([
      'registration.credentialsEncrypted',
      'registration.keyVersion',
    ]);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'registration.tenant_id = :tenantId',
      { tenantId },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'registration.active = true',
    );
  });

  it('looks up a registration using both tenant and registration IDs', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      registrations.findByTenantAndId(tenantId, id),
    ).resolves.toBeNull();
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { tenantId, id },
    });
  });

  it.each([0, 1])(
    'reports deletion of %i tenant-owned rows',
    async (affected) => {
      repository.delete.mockResolvedValue({ affected });

      await expect(
        registrations.deleteByTenantAndId(tenantId, id),
      ).resolves.toBe(affected === 1);
      expect(repository.delete).toHaveBeenCalledWith({ tenantId, id });
    },
  );
});
