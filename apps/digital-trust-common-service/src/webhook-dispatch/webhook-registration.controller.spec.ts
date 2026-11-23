import { randomBytes, randomUUID } from 'node:crypto';

import { AuthContext, WEBHOOKS_MANAGE_SCOPE } from '@app/auth';
import { HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { CreateWebhookRegistrationResponseDto } from './dto/create-webhook-registration-response.dto';
import { WebhookRegistrationResponseDto } from './dto/webhook-registration-response.dto';
import { WebhookRegistrationController } from './webhook-registration.controller';
import { WebhookRegistration } from './webhook-registration.entity';
import {
  WebhookEvent,
  WebhookRegistrationStatus,
} from './webhook-registration.enums';
import { WebhookRegistrationService } from './webhook-registration.service';

describe('WebhookRegistrationController', () => {
  const tenantId = randomUUID();
  const id = randomUUID();
  const auth = {
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
  } as AuthContext;
  const registration = Object.assign(new WebhookRegistration(), {
    id,
    tenantId,
    endpointUrl: 'https://93.184.216.34/events',
    events: [WebhookEvent.CREDENTIAL_ISSUED],
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    credentialsEncrypted: randomBytes(64),
    keyVersion: 1,
  });
  const service = {
    create: jest.fn(),
    findByTenant: jest.fn(),
    delete: jest.fn(),
  };
  let controller: WebhookRegistrationController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new WebhookRegistrationController(
      service as unknown as WebhookRegistrationService,
    );
  });

  it('registers the versioned tenant webhooks route', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, WebhookRegistrationController),
    ).toBe('tenants/:tenantId/webhooks');
  });

  it('returns the creation DTO with the one-time secret and no-store metadata', async () => {
    const signingSecret = randomBytes(32).toString('base64url');
    service.create.mockResolvedValue({ registration, signingSecret });

    const result = await controller.create(
      tenantId,
      {
        endpointUrl: registration.endpointUrl,
        events: registration.events,
      },
      auth,
    );

    expect(service.create).toHaveBeenCalledWith(
      tenantId,
      { endpointUrl: registration.endpointUrl, events: registration.events },
      auth,
    );
    expect(result).toBeInstanceOf(CreateWebhookRegistrationResponseDto);
    expect(result.signingSecret).toBe(signingSecret);
    expect(result).not.toHaveProperty('credentialsEncrypted');
    expect(result).not.toHaveProperty('keyVersion');
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        Reflect.get(
          WebhookRegistrationController.prototype,
          'create',
        ) as object,
      ),
    ).toEqual([{ name: 'Cache-Control', value: 'no-store' }]);
  });

  it('maps listed registrations through the secret-free response DTO', async () => {
    service.findByTenant.mockResolvedValue([registration]);

    const result = await controller.findByTenant(tenantId, auth);

    expect(service.findByTenant).toHaveBeenCalledWith(tenantId, auth);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toBeInstanceOf(WebhookRegistrationResponseDto);
    expect(result.data[0]).toMatchObject({
      id,
      tenantId,
      endpointUrl: registration.endpointUrl,
      events: registration.events,
      status: WebhookRegistrationStatus.ACTIVE,
    });
    expect(result.data[0]).not.toHaveProperty('signingSecret');
    expect(result.data[0]).not.toHaveProperty('credentialsEncrypted');
    expect(result.data[0]).not.toHaveProperty('keyVersion');
  });

  it('deletes only the requested tenant registration and returns no content', async () => {
    service.delete.mockResolvedValue(undefined);

    await expect(
      controller.delete(tenantId, id, auth),
    ).resolves.toBeUndefined();
    expect(service.delete).toHaveBeenCalledWith(tenantId, id, auth);
  });
});
