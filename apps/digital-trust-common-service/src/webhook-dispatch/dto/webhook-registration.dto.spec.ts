import { randomBytes, randomUUID } from 'node:crypto';

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { instanceToPlain, plainToInstance } from 'class-transformer';

import { WebhookRegistration } from '../webhook-registration.entity';
import {
  WebhookEvent,
  WebhookRegistrationStatus,
} from '../webhook-registration.enums';

import { CreateWebhookRegistrationResponseDto } from './create-webhook-registration-response.dto';
import { CreateWebhookRegistrationDto } from './create-webhook-registration.dto';
import { WebhookRegistrationResponseDto } from './webhook-registration-response.dto';

describe('Webhook registration contract', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const payload = {
    endpoint_url: 'https://example.com/webhooks/credentials',
    events: [WebhookEvent.CREDENTIAL_ISSUED],
  };

  function validate(payload: unknown): Promise<CreateWebhookRegistrationDto> {
    return pipe.transform(payload, {
      type: 'body',
      metatype: CreateWebhookRegistrationDto,
    }) as Promise<CreateWebhookRegistrationDto>;
  }

  it.each(Object.values(WebhookEvent))('accepts event %s', async (event) => {
    await expect(
      validate({ ...payload, events: [event] }),
    ).resolves.toMatchObject({
      endpointUrl: payload.endpoint_url,
      events: [event],
    });
  });

  it('accepts all six supported events together', async () => {
    const events = Object.values(WebhookEvent);
    expect(events).toHaveLength(6);
    await expect(validate({ ...payload, events })).resolves.toMatchObject({
      events,
    });
  });

  it.each([
    undefined,
    null,
    [],
    'credential.issued',
    ['unsupported.event'],
    [WebhookEvent.CREDENTIAL_ISSUED, WebhookEvent.CREDENTIAL_ISSUED],
    [WebhookEvent.CREDENTIAL_ISSUED, null],
  ])('rejects invalid subscriptions %p', async (events) => {
    await expect(validate({ ...payload, events })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    undefined,
    null,
    '',
    'not-a-url',
    'http://example.com/webhooks',
    'ftp://example.com/webhooks',
    'example.com/webhooks',
    'https://user:password@example.com/webhooks',
    'https://example.com/webhooks#fragment',
  ])('rejects invalid endpoint URL %p', async (endpointUrl) => {
    await expect(
      validate({ ...payload, endpoint_url: endpointUrl }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['signing_secret', 'secret', 'tenant_id', 'status', 'active'])(
    'rejects caller-supplied %s',
    async (field) => {
      const value = field.includes('secret')
        ? randomBytes(32).toString('base64url')
        : 'not-client-controlled';
      await expect(
        validate({ ...payload, [field]: value }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  function registrationResponse() {
    return {
      id: randomUUID(),
      tenant_id: randomUUID(),
      endpoint_url: payload.endpoint_url,
      events: payload.events,
      status: WebhookRegistrationStatus.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  it.each([true, false])(
    'maps entity fields with active=%s without credentials',
    (active) => {
      const expected = {
        ...registrationResponse(),
        status: active
          ? WebhookRegistrationStatus.ACTIVE
          : WebhookRegistrationStatus.INACTIVE,
      };
      const registration = Object.assign(new WebhookRegistration(), {
        id: expected.id,
        tenantId: expected.tenant_id,
        endpointUrl: expected.endpoint_url,
        events: expected.events,
        active,
        createdAt: expected.created_at,
        updatedAt: expected.updated_at,
        credentialsEncrypted: randomBytes(64),
        keyVersion: 1,
      });
      const dto = WebhookRegistrationResponseDto.fromEntity(registration);

      expect(dto).not.toHaveProperty('credentialsEncrypted');
      expect(dto).not.toHaveProperty('keyVersion');
      expect(dto).not.toHaveProperty('signingSecret');
      expect(instanceToPlain(dto)).toEqual(expected);

      const signingSecret = randomBytes(32).toString('base64url');
      const created = CreateWebhookRegistrationResponseDto.from(
        registration,
        signingSecret,
      );
      expect(created).not.toHaveProperty('credentialsEncrypted');
      expect(created).not.toHaveProperty('keyVersion');
      expect(instanceToPlain(created)).toEqual({
        ...expected,
        signing_secret: signingSecret,
      });
    },
  );

  it.each(Object.values(WebhookRegistrationStatus))(
    'serializes a %s registration without secret or persistence fields',
    (status) => {
      const expected = { ...registrationResponse(), status };
      const dto = plainToInstance(WebhookRegistrationResponseDto, {
        ...expected,
        signing_secret: randomBytes(32).toString('base64url'),
        credentials_encrypted: randomBytes(64),
        key_version: 1,
        active: true,
        tenant: { id: expected.tenant_id },
      });

      expect(instanceToPlain(dto)).toEqual(expected);
    },
  );

  it('includes the signing secret only in the creation response', () => {
    const expected = {
      ...registrationResponse(),
      signing_secret: randomBytes(32).toString('base64url'),
    };
    const dto = plainToInstance(CreateWebhookRegistrationResponseDto, {
      ...expected,
      credentials_encrypted: randomBytes(64),
      key_version: 1,
    });

    expect(instanceToPlain(dto)).toEqual(expected);
    expect(
      instanceToPlain(
        plainToInstance(WebhookRegistrationResponseDto, expected),
      ),
    ).not.toHaveProperty('signing_secret');
  });
});
