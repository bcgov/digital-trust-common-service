import { NotFoundException } from '@nestjs/common';

import { OAuthClientLookupAdapter } from './oauth-client-lookup.adapter';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientService } from './oauth-client.service';

// Mock argon2 to avoid loading the native binding transitively via
// OAuthClientService (see oauth-client.service.spec.ts for precedent).
jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed_secret'),
  verify: jest.fn(),
  argon2i: 'argon2i',
}));

describe('OAuthClientLookupAdapter', () => {
  let mockFindByClientId: jest.Mock;
  let adapter: OAuthClientLookupAdapter;

  const activeClient: OAuthClient = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    clientId: 'client_abc123',
    clientSecretHash: 'hashed_secret',
    name: 'Test Client',
    scopes: ['read:credentials'],
    redirectUris: ['https://example.com/callback'],
    grantTypes: ['client_credentials'],
    createdBy: '123e4567-e89b-12d3-a456-426614174002',
    createdAt: new Date(),
    revokedAt: undefined,
    tenant: undefined,
  } as OAuthClient;

  beforeEach(() => {
    mockFindByClientId = jest.fn();

    const oauthClientService = {
      findByClientId: mockFindByClientId,
    } as unknown as OAuthClientService;

    adapter = new OAuthClientLookupAdapter(oauthClientService);
  });

  it('maps an active client onto an OidcClientRecord', async () => {
    mockFindByClientId.mockResolvedValue(activeClient);

    await expect(adapter.findActiveClient('client_abc123')).resolves.toEqual({
      clientId: 'client_abc123',
      clientSecretHash: 'hashed_secret',
      name: 'Test Client',
      tenantId: '123e4567-e89b-12d3-a456-426614174001',
      scopes: ['read:credentials'],
      redirectUris: ['https://example.com/callback'],
      grantTypes: ['client_credentials'],
    });
  });

  it('returns undefined for a revoked client', async () => {
    mockFindByClientId.mockResolvedValue({
      ...activeClient,
      revokedAt: new Date(),
    });

    await expect(
      adapter.findActiveClient('client_abc123'),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when the client is not found', async () => {
    mockFindByClientId.mockRejectedValue(new NotFoundException('not found'));

    await expect(adapter.findActiveClient('missing')).resolves.toBeUndefined();
  });

  it('rethrows unexpected errors', async () => {
    mockFindByClientId.mockRejectedValue(new Error('boom'));

    await expect(adapter.findActiveClient('client_abc123')).rejects.toThrow(
      'boom',
    );
  });
});
