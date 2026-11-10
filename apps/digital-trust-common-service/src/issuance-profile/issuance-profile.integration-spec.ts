import { createTestTenant } from '@app/credential-ports/testing/test-data.factory';
import { buildSslConfig } from '@app/database/ssl.util';
import { DataSource, EntityManager } from 'typeorm';

import { ConnectorType } from '../connection/connection.entity';
import { Connector } from '../connector/connector.entity';
import { Credential, CredentialState } from '../credential/credential.entity';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
  CredentialDefinitionStatus,
} from '../credential-definition/credential-definition.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation } from '../operation/operation.entity';
import { SEED_ENTITIES } from '../seed/seed.constants';
import { Tenant } from '../tenant/tenant.entity';

import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from './issuance-profile.entity';
import {
  IssuanceProfileDeleteResult,
  IssuanceProfileRepository,
} from './issuance-profile.repository';

describe('Issuance profile lifecycle (integration)', () => {
  let dataSource: DataSource;
  let profiles: IssuanceProfileRepository;
  let tenantId: string;
  let otherTenantId: string;
  let connectorId: string;
  let profile: IssuanceProfile;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [...SEED_ENTITIES, Credential],
      synchronize: false,
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    });
    await dataSource.initialize();
    profiles = new IssuanceProfileRepository(
      dataSource.getRepository(IssuanceProfile),
    );
  });

  beforeEach(async () => {
    const tenant = createTestTenant();
    tenantId = tenant.id;
    const otherTenant = createTestTenant();
    otherTenantId = otherTenant.id;
    await dataSource.manager.save(Tenant, [
      { id: tenantId, name: tenant.name, slug: tenant.slug },
      { id: otherTenantId, name: otherTenant.name, slug: otherTenant.slug },
    ]);
    const connector = await dataSource.manager.save(Connector, {
      tenantId,
      connectorType: ConnectorType.TRACTION,
      endpointUrl: 'https://traction.example.test',
      credentialsEncrypted: Buffer.alloc(1),
      active: true,
    });
    connectorId = connector.id;
    const definition = await dataSource.manager.save(CredentialDefinition, {
      tenantId,
      name: 'Lifecycle definition',
      format: CredentialDefinitionFormat.ANONCREDS,
      connectorType: CredentialDefinitionConnectorType.TRACTION,
      connectorId,
      schemaDefinition: { attr_names: ['name'] },
      options: { format: 'anoncreds' },
      status: CredentialDefinitionStatus.PUBLISHED,
      registrationState: 'ready',
      externalId: 'lifecycle-definition',
    });
    profile = await profiles.create({
      tenantId,
      name: 'Lifecycle profile',
      version: '1.0',
      credentialDefinitionId: definition.id,
      attributeSchema: {},
      status: IssuanceProfileStatus.PUBLISHED,
    });
  });

  afterEach(async () => {
    await dataSource.manager.delete(Credential, { tenantId });
    await dataSource.manager.delete(Operation, { tenantId });
    await dataSource.manager.delete(Tenant, { id: tenantId });
    await dataSource.manager.delete(Tenant, { id: otherTenantId });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function persistRequest(
    manager: EntityManager,
    state = CredentialState.OFFERED,
  ): Promise<Credential> {
    const operation = await manager.save(Operation, {
      tenantId,
      type: OPERATION_TYPE.CREDENTIAL_OFFER,
      request: {
        method: 'POST',
        path: '/offer',
        body: { profile_id: profile.id },
      },
      expiresAt: new Date(Date.now() + 60_000),
    });
    return manager.save(Credential, {
      tenantId,
      issuanceProfileId: profile.id,
      connectorId,
      operationId: operation.id,
      format: CredentialDefinitionFormat.ANONCREDS,
      state,
      metadata: {},
    });
  }

  it('only deletes an unused profile in its owning tenant', async () => {
    expect(await profiles.findUsedProfileIds(tenantId, [profile.id])).toEqual(
      new Set(),
    );
    expect(await profiles.deleteIfUnused(otherTenantId, profile.id)).toBe(
      IssuanceProfileDeleteResult.NOT_FOUND,
    );
    expect(await profiles.deleteIfUnused(tenantId, profile.id)).toBe(
      IssuanceProfileDeleteResult.DELETED,
    );
    expect(await profiles.findById(profile.id)).toBeNull();
  });

  it.each(Object.values(CredentialState))(
    'preserves profiles used by %s requests',
    async (state) => {
      const credential = await persistRequest(dataSource.manager, state);
      expect(await profiles.findUsedProfileIds(tenantId, [profile.id])).toEqual(
        new Set([profile.id]),
      );
      expect(
        await profiles.findUsedProfileIds(otherTenantId, [profile.id]),
      ).toEqual(new Set());
      expect(await profiles.deleteIfUnused(tenantId, profile.id)).toBe(
        IssuanceProfileDeleteResult.USED,
      );
      expect(
        await dataSource.manager.findOneBy(Credential, {
          id: credential.id,
          tenantId,
        }),
      ).toMatchObject({ issuanceProfileId: profile.id });
    },
  );

  it('retains archived name/version reservations and existing credentials', async () => {
    const credential = await persistRequest(
      dataSource.manager,
      CredentialState.FAILED,
    );
    expect(
      await profiles.transitionStatus(
        tenantId,
        profile.id,
        IssuanceProfileStatus.PUBLISHED,
        IssuanceProfileStatus.DEPRECATED,
      ),
    ).toBe(true);
    expect(
      await profiles.findByNameAndVersion(
        tenantId,
        profile.name,
        profile.version,
      ),
    ).toMatchObject({ status: IssuanceProfileStatus.DEPRECATED });
    await expect(
      profiles.create({
        tenantId,
        name: profile.name,
        version: profile.version,
        credentialDefinitionId: profile.credentialDefinitionId,
        attributeSchema: {},
      }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    expect(await profiles.deleteIfUnused(tenantId, profile.id)).toBe(
      IssuanceProfileDeleteResult.USED,
    );
    expect(
      await dataSource.manager.findOneBy(Credential, {
        id: credential.id,
        tenantId,
      }),
    ).toMatchObject({ issuanceProfileId: profile.id });
  });

  it('serializes deletion and archival behind an issuance transaction', async () => {
    const issuance = dataSource.createQueryRunner();
    const lifecycle = dataSource.createQueryRunner();
    await issuance.connect();
    await lifecycle.connect();
    await issuance.startTransaction();
    await lifecycle.startTransaction();
    try {
      await issuance.manager.findOneOrFail(IssuanceProfile, {
        where: {
          id: profile.id,
          tenantId,
          status: IssuanceProfileStatus.PUBLISHED,
        },
        lock: { mode: 'pessimistic_read' },
      });
      await lifecycle.query("SET LOCAL lock_timeout = '100ms'");
      const competing = new IssuanceProfileRepository(
        lifecycle.manager.getRepository(IssuanceProfile),
      );
      await expect(
        competing.deleteIfUnused(tenantId, profile.id),
      ).rejects.toMatchObject({ driverError: { code: '55P03' } });
      await lifecycle.rollbackTransaction();
      await lifecycle.startTransaction();
      await lifecycle.query("SET LOCAL lock_timeout = '100ms'");
      await expect(
        competing.transitionStatus(
          tenantId,
          profile.id,
          IssuanceProfileStatus.PUBLISHED,
          IssuanceProfileStatus.DEPRECATED,
        ),
      ).rejects.toMatchObject({ driverError: { code: '55P03' } });
      await lifecycle.rollbackTransaction();
      await persistRequest(issuance.manager);
      await issuance.commitTransaction();
      expect(await profiles.deleteIfUnused(tenantId, profile.id)).toBe(
        IssuanceProfileDeleteResult.USED,
      );
      expect(
        await profiles.transitionStatus(
          tenantId,
          profile.id,
          IssuanceProfileStatus.PUBLISHED,
          IssuanceProfileStatus.DEPRECATED,
        ),
      ).toBe(true);
      expect(
        await dataSource.manager.findOne(IssuanceProfile, {
          where: {
            id: profile.id,
            tenantId,
            status: IssuanceProfileStatus.PUBLISHED,
          },
        }),
      ).toBeNull();
    } finally {
      if (issuance.isTransactionActive) await issuance.rollbackTransaction();
      if (lifecycle.isTransactionActive) await lifecycle.rollbackTransaction();
      await issuance.release();
      await lifecycle.release();
    }
  });
});
