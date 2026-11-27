import { randomUUID } from 'crypto';

import type { AuthContext } from '@app/auth';
import { AppDataSource } from '@app/database/data-source';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { DomainAuditService } from '../audit-log/domain-audit.service';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { OperationService } from '../operation/operation.service';
import { SEED_ENTITIES } from '../seed/seed.constants';

import { PresentationDefinition } from './presentation-definition.entity';
import { PresentationDefinitionRepository } from './presentation-definition.repository';
import { VerificationProfile } from './verification-profile.entity';
import { VerificationProfileRepository } from './verification-profile.repository';
import { VerificationProfileService } from './verification-profile.service';

describe('Verification profile configuration integration', () => {
  let dataSource: DataSource;
  let service: VerificationProfileService;
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const createCompleted = jest.fn();
  const auth = {
    sub: 'test',
    tokenType: 'user',
    clientId: 'test',
    tenantId,
    roles: [],
    scope: 'profiles:manage',
    scopes: ['profiles:manage'],
    iss: 'test',
    aud: 'test',
    iat: 1,
    exp: 9999999999,
  } satisfies AuthContext;

  beforeAll(async () => {
    const migrations = new DataSource({
      ...AppDataSource.options,
      entities: [],
    });
    await migrations.initialize();
    await migrations.runMigrations();
    await migrations.destroy();
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [...SEED_ENTITIES],
    });
    await dataSource.initialize();
    await dataSource.query(
      'INSERT INTO tenant(id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)',
      [tenantId, 'Test', tenantId, otherTenantId, 'Other', otherTenantId],
    );
    service = new VerificationProfileService(
      new VerificationProfileRepository(
        dataSource.getRepository(VerificationProfile),
      ),
      {
        emit: jest.fn().mockResolvedValue(undefined),
      } as unknown as DomainAuditService,
      dataSource,
      { createCompleted } as unknown as OperationService,
      new PresentationDefinitionRepository(
        dataSource.getRepository(PresentationDefinition),
      ),
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM tenant WHERE id IN ($1, $2)', [
        tenantId,
        otherTenantId,
      ]);
      await dataSource.destroy();
    }
  });

  it('links one canonical definition, scopes reads, and enforces the lifecycle', async () => {
    createCompleted.mockImplementation(
      (_input: unknown, result: Record<string, unknown>) =>
        Promise.resolve({ id: randomUUID(), result }),
    );
    const created = await service.createDefinition(
      tenantId,
      {
        name: 'identity',
        version: '1.0',
        query: {
          type: 'dif-presentation-exchange',
          presentationDefinition: {
            id: 'identity',
            input_descriptors: [
              {
                id: 'person',
                constraints: {
                  fields: [{ path: ['$.credentialSubject.name'] }],
                },
              },
            ],
          },
        },
        options: { format: CredentialDefinitionFormat.ANONCREDS },
      },
      auth,
    );
    const definitionId = String(created.result?.id);
    const otherAuth = { ...auth, tenantId: otherTenantId };
    await expect(
      service.findDefinition(otherTenantId, definitionId, otherAuth),
    ).rejects.toThrow(NotFoundException);
    await service.publishDefinition(tenantId, definitionId, auth);

    const result = await service.profileOperation(
      tenantId,
      OPERATION_TYPE.VERIFICATION_PROFILE_CREATE,
      'POST',
      '',
      {},
      (manager) =>
        service.create(
          tenantId,
          {
            name: 'profile',
            version: '1.0',
            presentationDefinitionId: definitionId,
          },
          auth,
          manager,
        ),
    );
    const profileId = String(result.result?.id);
    await service.profileOperation(
      tenantId,
      OPERATION_TYPE.VERIFICATION_PROFILE_UPDATE,
      'PATCH',
      `/${profileId}`,
      { description: 'updated' },
      (manager) =>
        service.update(
          tenantId,
          profileId,
          { description: 'updated' },
          auth,
          manager,
        ),
    );
    await service.profileOperation(
      tenantId,
      OPERATION_TYPE.VERIFICATION_PROFILE_PUBLISH,
      'POST',
      `/${profileId}/publish`,
      {},
      (manager) => service.publish(tenantId, profileId, auth, manager),
    );
    const profile = await service.findById(tenantId, profileId, auth);
    expect(profile.definition.id).toBe(definitionId);
    expect(profile.definition.requestedAttributes).toEqual(['name']);
    expect(profile.delivery).toEqual({ protocol: 'didcomm-v1' });
    await expect(
      service.deprecateDefinition(tenantId, definitionId, auth),
    ).rejects.toThrow(ConflictException);
    await service.profileOperation(
      tenantId,
      OPERATION_TYPE.VERIFICATION_PROFILE_DEPRECATE,
      'POST',
      `/${profileId}/deprecate`,
      {},
      (manager) => service.deprecate(tenantId, profileId, auth, manager),
    );
    await service.deprecateDefinition(tenantId, definitionId, auth);
  });

  it('rolls back a definition when operation persistence fails', async () => {
    createCompleted.mockRejectedValueOnce(new Error('operation write failed'));
    await expect(
      service.createDefinition(
        tenantId,
        {
          name: 'rollback',
          version: '1.0',
          query: {
            type: 'dif-presentation-exchange',
            presentationDefinition: {
              id: 'rollback',
              input_descriptors: [
                {
                  id: 'person',
                  constraints: {
                    fields: [{ path: ['$.credentialSubject.name'] }],
                  },
                },
              ],
            },
          },
          options: { format: CredentialDefinitionFormat.ANONCREDS },
        },
        auth,
      ),
    ).rejects.toThrow('operation write failed');
    expect(
      await dataSource
        .getRepository(PresentationDefinition)
        .findOneBy({ tenantId, name: 'rollback' }),
    ).toBeNull();
  });
});
