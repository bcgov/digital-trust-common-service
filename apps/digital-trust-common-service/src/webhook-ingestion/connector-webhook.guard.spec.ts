import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { ConnectorCredentialService } from '../connector-credential/connector-credential.service';

import {
  ConnectorWebhookGuard,
  ConnectorWebhookRequest,
  WEBHOOK_SECRET_HEADER,
} from './connector-webhook.guard';

describe('ConnectorWebhookGuard', () => {
  let guard: ConnectorWebhookGuard;
  let connectorCredentialService: jest.Mocked<
    Pick<ConnectorCredentialService, 'findActiveForWebhook'>
  >;
  let encryptionService: jest.Mocked<Pick<EncryptionService, 'decrypt'>>;

  const connectorId = 'connector-1';
  const credential = {
    id: connectorId,
    tenantId: 'tenant-1',
    connectorType: ConnectorType.TRACTION,
    credentialsEncrypted: Buffer.from('ciphertext'),
    keyVersion: 1,
    active: true,
  } as ConnectorCredential;

  beforeEach(() => {
    connectorCredentialService = {
      findActiveForWebhook: jest.fn(),
    };
    encryptionService = {
      decrypt: jest.fn(),
    };
    guard = new ConnectorWebhookGuard(
      connectorCredentialService as unknown as ConnectorCredentialService,
      encryptionService as unknown as EncryptionService,
    );
  });

  function createContext(
    request: Partial<ConnectorWebhookRequest>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  it('allows the request and attaches connectorId/tenantId/connectorType when the secret matches', async () => {
    connectorCredentialService.findActiveForWebhook.mockResolvedValue(
      credential,
    );
    encryptionService.decrypt.mockReturnValue({
      apiKey: 'key',
      webhookSecret: 'correct-secret',
    });

    const request: ConnectorWebhookRequest = {
      params: { connectorId },
      headers: { [WEBHOOK_SECRET_HEADER]: 'correct-secret' },
    } as unknown as ConnectorWebhookRequest;

    const allowed = await guard.canActivate(createContext(request));

    expect(allowed).toBe(true);
    expect(request.connectorId).toBe(connectorId);
    expect(request.tenantId).toBe('tenant-1');
    expect(request.connectorType).toBe(ConnectorType.TRACTION);
    expect(
      connectorCredentialService.findActiveForWebhook,
    ).toHaveBeenCalledWith(connectorId);
  });

  it('rejects with a generic 401 when the connector id is missing', async () => {
    const request = {
      params: {},
      headers: { [WEBHOOK_SECRET_HEADER]: 'anything' },
    } as unknown as ConnectorWebhookRequest;

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(
      connectorCredentialService.findActiveForWebhook,
    ).not.toHaveBeenCalled();
  });

  it('rejects with a generic 401 when the secret header is missing', async () => {
    const request = {
      params: { connectorId },
      headers: {},
    } as unknown as ConnectorWebhookRequest;

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(
      connectorCredentialService.findActiveForWebhook,
    ).not.toHaveBeenCalled();
  });

  it('rejects with the same generic 401 when no active connector matches the id', async () => {
    connectorCredentialService.findActiveForWebhook.mockResolvedValue(null);

    const request = {
      params: { connectorId },
      headers: { [WEBHOOK_SECRET_HEADER]: 'anything' },
    } as unknown as ConnectorWebhookRequest;

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(encryptionService.decrypt).not.toHaveBeenCalled();
  });

  it('rejects when the connector has no webhookSecret configured', async () => {
    connectorCredentialService.findActiveForWebhook.mockResolvedValue(
      credential,
    );
    encryptionService.decrypt.mockReturnValue({ apiKey: 'key' });

    const request = {
      params: { connectorId },
      headers: { [WEBHOOK_SECRET_HEADER]: 'anything' },
    } as unknown as ConnectorWebhookRequest;

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when the provided secret does not match the configured one', async () => {
    connectorCredentialService.findActiveForWebhook.mockResolvedValue(
      credential,
    );
    encryptionService.decrypt.mockReturnValue({
      apiKey: 'key',
      webhookSecret: 'correct-secret',
    });

    const request = {
      params: { connectorId },
      headers: { [WEBHOOK_SECRET_HEADER]: 'wrong-secret' },
    } as unknown as ConnectorWebhookRequest;

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
