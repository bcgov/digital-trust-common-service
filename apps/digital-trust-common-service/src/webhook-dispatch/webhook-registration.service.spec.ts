import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import {
  InsufficientScopeException,
  PLATFORM_ADMIN_ROLE,
  ScopeAuthorizationService,
  TENANT_SUPERUSER_SCOPE,
  TenantAccessDeniedException,
  WEBHOOKS_MANAGE_SCOPE,
  type AuthContext,
} from '@app/auth';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { assertSafePublicHttpsUrl } from '../common/assert-safe-connector-url';
import { EncryptionService } from '../common/crypto/encryption.service';
import { KeyProviderService } from '../common/crypto/key-provider.service';

import { WebhookRegistration } from './webhook-registration.entity';
import { WebhookEvent } from './webhook-registration.enums';
import { WebhookRegistrationRepository } from './webhook-registration.repository';
import { WebhookRegistrationService } from './webhook-registration.service';

jest.mock('../common/assert-safe-connector-url', () => ({
  assertSafePublicHttpsUrl: jest.fn().mockResolvedValue(undefined),
}));

describe('WebhookRegistrationService', () => {
  const tenantId = randomUUID();
  const auth: AuthContext = {
    sub: randomUUID(),
    tokenType: 'user',
    clientId: null,
    tenantId,
    roles: ['admin'],
    scope: WEBHOOKS_MANAGE_SCOPE,
    scopes: [WEBHOOKS_MANAGE_SCOPE],
    iss: 'https://issuer.example.test',
    aud: 'https://api.example.test',
    iat: 0,
    exp: 300,
  };
  const keys = { 1: randomBytes(32), 2: randomBytes(32) };
  const keyProvider = {
    getCurrentKey: jest.fn(),
    getKey: jest.fn(),
  };
  const registrations = {
    create: jest.fn(),
    findByTenant: jest.fn(),
    deleteByTenantAndId: jest.fn(),
  };
  const audit = { emit: jest.fn() };
  const dto = {
    endpointUrl: 'https://example.com/webhooks',
    events: [WebhookEvent.CREDENTIAL_ISSUED],
  };
  let service: WebhookRegistrationService;
  let encryption: EncryptionService;

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
    audit.emit.mockResolvedValue(undefined);
    keyProvider.getCurrentKey.mockReturnValue({ version: 1, key: keys[1] });
    keyProvider.getKey.mockImplementation((version: 1 | 2) => ({
      version,
      key: keys[version],
    }));
    registrations.create.mockImplementation(
      (tenantId: string, data: Partial<WebhookRegistration>) =>
        Promise.resolve(
          Object.assign(new WebhookRegistration(), {
            ...data,
            id: randomUUID(),
            tenantId,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
    );
    const module = await Test.createTestingModule({
      providers: [
        WebhookRegistrationService,
        ScopeAuthorizationService,
        EncryptionService,
        { provide: DomainAuditService, useValue: audit },
        { provide: KeyProviderService, useValue: keyProvider },
        { provide: WebhookRegistrationRepository, useValue: registrations },
      ],
    }).compile();
    service = module.get(WebhookRegistrationService);
    encryption = module.get(EncryptionService);
  });

  it('returns a 32-byte secret and persists only its versioned encrypted envelope', async () => {
    const { registration, signingSecret } = await service.create(
      tenantId,
      dto,
      auth,
    );

    expect(signingSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(signingSecret, 'base64url')).toHaveLength(32);
    expect(registrations.create).toHaveBeenCalledWith(tenantId, {
      ...dto,
      credentialsEncrypted: expect.any(Buffer),
      keyVersion: 1,
    });
    expect(assertSafePublicHttpsUrl).toHaveBeenCalledWith(
      dto.endpointUrl,
      'Webhook endpoint',
    );
    expect(registration).not.toHaveProperty('signingSecret');
    expect(audit.emit).toHaveBeenCalledWith({
      tenantId,
      action: AuditAction.CREATE,
      resourceType: 'webhook_registration',
      resourceId: registration.id,
    });
    expect(
      registration.credentialsEncrypted.includes(Buffer.from(signingSecret)),
    ).toBe(false);
    expect(
      encryption.decrypt(
        registration.credentialsEncrypted,
        registration.keyVersion,
      ),
    ).toEqual({ signingSecret });
  });

  it('generates independent secrets and envelopes for each registration', async () => {
    const first = await service.create(tenantId, dto, auth);
    const second = await service.create(tenantId, dto, auth);

    expect(first.signingSecret).not.toBe(second.signingSecret);
    expect(first.registration.credentialsEncrypted).not.toEqual(
      second.registration.credentialsEncrypted,
    );
  });

  it('keeps older credentials decryptable after the current encryption key rotates', async () => {
    const first = await service.create(tenantId, dto, auth);
    keyProvider.getCurrentKey.mockReturnValue({ version: 2, key: keys[2] });
    const second = await service.create(tenantId, dto, auth);

    expect(first.registration.keyVersion).toBe(1);
    expect(second.registration.keyVersion).toBe(2);
    for (const { registration, signingSecret } of [first, second]) {
      expect(
        encryption.decrypt(
          registration.credentialsEncrypted,
          registration.keyVersion,
        ),
      ).toEqual({ signingSecret });
    }
  });

  it('recovers the same signing key the recipient receives', async () => {
    const { registration, signingSecret } = await service.create(
      tenantId,
      dto,
      auth,
    );
    const stored = encryption.decrypt<{ signingSecret: string }>(
      registration.credentialsEncrypted,
      registration.keyVersion,
    );
    const payload = JSON.stringify({ event: WebhookEvent.CREDENTIAL_ISSUED });

    expect(
      createHmac('sha256', stored.signingSecret).update(payload).digest('hex'),
    ).toBe(createHmac('sha256', signingSecret).update(payload).digest('hex'));
  });

  it('does not persist anything if encryption fails', async () => {
    const failure = new Error('Encryption unavailable');
    jest.spyOn(encryption, 'encrypt').mockImplementationOnce(() => {
      throw failure;
    });

    await expect(service.create(tenantId, dto, auth)).rejects.toBe(failure);
    expect(registrations.create).not.toHaveBeenCalled();
    expect(audit.emit).not.toHaveBeenCalled();
  });

  it('rejects unsafe URLs before generating or persisting a secret', async () => {
    const failure = new Error('Unsafe destination');
    const encrypt = jest.spyOn(encryption, 'encrypt');
    jest.mocked(assertSafePublicHttpsUrl).mockRejectedValueOnce(failure);

    await expect(service.create(tenantId, dto, auth)).rejects.toBe(failure);
    expect(encrypt).not.toHaveBeenCalled();
    expect(registrations.create).not.toHaveBeenCalled();
    expect(audit.emit).not.toHaveBeenCalled();
  });

  it('does not return a creation result if persistence fails', async () => {
    const failure = new Error('Persistence unavailable');
    registrations.create.mockRejectedValueOnce(failure);

    await expect(service.create(tenantId, dto, auth)).rejects.toBe(failure);
    expect(audit.emit).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing context',
      context: undefined,
      error: TenantAccessDeniedException,
    },
    {
      name: 'missing tenant',
      context: { ...auth, tenantId: null },
      error: TenantAccessDeniedException,
    },
    {
      name: 'another tenant',
      context: { ...auth, tenantId: randomUUID() },
      error: TenantAccessDeniedException,
    },
    {
      name: 'missing scope',
      context: { ...auth, scope: '', scopes: [] },
      error: InsufficientScopeException,
    },
  ])(
    'rejects $name before any registration access',
    async ({ context, error }) => {
      const encrypt = jest.spyOn(encryption, 'encrypt');

      await expect(
        service.create(tenantId, dto, context),
      ).rejects.toBeInstanceOf(error);
      await expect(
        service.findByTenant(tenantId, context),
      ).rejects.toBeInstanceOf(error);
      await expect(
        service.delete(tenantId, randomUUID(), context),
      ).rejects.toBeInstanceOf(error);

      expect(encrypt).not.toHaveBeenCalled();
      expect(registrations.create).not.toHaveBeenCalled();
      expect(registrations.findByTenant).not.toHaveBeenCalled();
      expect(registrations.deleteByTenantAndId).not.toHaveBeenCalled();
      expect(audit.emit).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      ...auth,
      roles: ['owner'],
      scope: TENANT_SUPERUSER_SCOPE,
      scopes: [TENANT_SUPERUSER_SCOPE],
    },
    {
      ...auth,
      roles: [PLATFORM_ADMIN_ROLE],
      tenantId: null,
      scope: '',
      scopes: [],
    },
    { ...auth, roles: [], tokenType: 'client' as const },
  ])(
    'honors inherited, platform, and delegated permissions for %j',
    async (context) => {
      registrations.findByTenant.mockResolvedValue([]);
      registrations.deleteByTenantAndId.mockResolvedValue(true);
      await expect(
        service.create(tenantId, dto, context),
      ).resolves.toHaveProperty('signingSecret');
      await expect(service.findByTenant(tenantId, context)).resolves.toEqual(
        [],
      );
      await expect(
        service.delete(tenantId, randomUUID(), context),
      ).resolves.toBeUndefined();
    },
  );

  it('lists only registrations for the authorized tenant', async () => {
    registrations.findByTenant.mockResolvedValue([]);

    await expect(service.findByTenant(tenantId, auth)).resolves.toEqual([]);
    expect(registrations.findByTenant).toHaveBeenCalledWith(tenantId);
    expect(audit.emit).not.toHaveBeenCalled();
  });

  it('audits a successful tenant-scoped hard delete without credential metadata', async () => {
    const id = randomUUID();
    registrations.deleteByTenantAndId.mockResolvedValue(true);

    await service.delete(tenantId, id, auth);

    expect(registrations.deleteByTenantAndId).toHaveBeenCalledWith(
      tenantId,
      id,
    );
    expect(audit.emit).toHaveBeenCalledWith({
      tenantId,
      action: AuditAction.DELETE,
      resourceType: 'webhook_registration',
      resourceId: id,
    });
  });

  it('returns not found without auditing a missing or foreign registration', async () => {
    registrations.deleteByTenantAndId.mockResolvedValue(false);

    await expect(
      service.delete(tenantId, randomUUID(), auth),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.emit).not.toHaveBeenCalled();
  });
});
