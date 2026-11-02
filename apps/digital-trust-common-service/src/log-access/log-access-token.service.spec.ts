import {
  AuthenticationRequiredException,
  JwtValidationService,
  ScopeAuthorizationService,
} from '@app/auth';
import { OidcConfigService } from '@app/oidc';
import { ConfigService } from '@nestjs/config';

import { LogAccessDeniedError } from './log-access-denied.error';
import { LogAccessTokenService } from './log-access-token.service';

const AUDIENCE = 'https://log-gateway.example.test';
const TENANT_ID = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e7b11';

describe('LogAccessTokenService', () => {
  let verify: jest.Mock;
  let audiences: string[];
  let configured: string | undefined;
  let service: LogAccessTokenService;

  const deniedWith = async (status: number, reason: string): Promise<void> => {
    await expect(service.authorize('Bearer t')).rejects.toMatchObject({
      status,
      reason,
    });
  };

  beforeEach(() => {
    verify = jest.fn().mockResolvedValue({
      tenant_id: TENANT_ID,
      scope: 'logs:read',
    });
    audiences = [AUDIENCE];
    configured = AUDIENCE;

    service = new LogAccessTokenService(
      { verifyBearerForAudience: verify } as unknown as JwtValidationService,
      new ScopeAuthorizationService(),
      {
        getConfig: () => ({ additionalAudiences: audiences }),
      } as unknown as OidcConfigService,
      { get: () => configured } as unknown as ConfigService,
    );
  });

  it('accepts a valid gateway token and returns the tenant', async () => {
    await expect(service.authorize('Bearer t')).resolves.toEqual({
      tenantId: TENANT_ID,
    });
    expect(verify).toHaveBeenCalledWith('Bearer t', AUDIENCE);
  });

  it('denies 401 when the token fails validation', async () => {
    verify.mockRejectedValue(new AuthenticationRequiredException('bad'));
    await deniedWith(401, 'invalid_token');
  });

  it('rethrows unexpected errors instead of treating them as denial', async () => {
    verify.mockRejectedValue(new Error('boom'));
    await expect(service.authorize('Bearer t')).rejects.toThrow('boom');
  });

  it.each([
    ['missing', undefined],
    ['array', [TENANT_ID, TENANT_ID]],
    ['uppercase', TENANT_ID.toUpperCase()],
    ['empty', ''],
    ['non-uuid', 'tenant-a'],
    ['delimiter-bearing', `${TENANT_ID}|other`],
  ])('denies 401 for a %s tenant_id', async (_name, tenantId) => {
    verify.mockResolvedValue({ tenant_id: tenantId, scope: 'logs:read' });
    await deniedWith(401, 'invalid_tenant_id');
  });

  it('denies 403 without logs:read', async () => {
    verify.mockResolvedValue({ tenant_id: TENANT_ID, scope: 'tenant:read' });
    await deniedWith(403, 'missing_logs_read_scope');
  });

  it('gives a platform-admin role no cross-tenant bypass', async () => {
    verify.mockResolvedValue({
      tenant_id: TENANT_ID,
      roles: ['platform-admin'],
      scope: 'openid',
    });
    await deniedWith(403, 'missing_logs_read_scope');
  });

  it('denies 401 when the audience is unset', async () => {
    configured = undefined;
    await deniedWith(401, 'audience_not_configured');
    expect(verify).not.toHaveBeenCalled();
  });

  it('denies 401 when the audience cannot be minted by the provider', async () => {
    audiences = [];
    await deniedWith(401, 'audience_not_configured');
  });

  it('uses LogAccessDeniedError for denials', async () => {
    configured = undefined;
    await expect(service.authorize('Bearer t')).rejects.toBeInstanceOf(
      LogAccessDeniedError,
    );
  });
});
