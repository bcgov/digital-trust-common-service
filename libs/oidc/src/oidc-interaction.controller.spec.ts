/* eslint-disable @typescript-eslint/no-unsafe-argument */
jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
  argon2i: 'argon2i',
}));
jest.mock('jose', () => ({}));
jest.mock('oidc-provider', () => ({ default: class FakeProvider {} }));
jest.mock('openid-client', () => ({
  discovery: jest.fn(),
  randomPKCECodeVerifier: jest.fn(),
  calculatePKCECodeChallenge: jest.fn(),
  randomState: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  authorizationCodeGrant: jest.fn(),
}));

import { IncomingMessage } from 'http';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { OidcInteractionController } from './oidc-interaction.controller';
import { OidcProviderService } from './oidc-provider.service';
import { OidcSessionRepository } from './oidc-session.repository';
import { OIDC_CLIENT_LOOKUP_PORT } from './ports/oidc-client-lookup.port';
import { OIDC_ROLE_SCOPE_PORT } from './ports/oidc-role-scope.port';
import {
  OIDC_TENANT_USER_PORT,
  OidcTenantUserRole,
  OidcTenantUserStatus,
} from './ports/oidc-tenant-user.port';
import { OIDC_UPSTREAM_FEDERATION_PORT } from './ports/oidc-upstream-federation.port';

describe('OidcInteractionController', () => {
  let controller: OidcInteractionController;
  let module: TestingModule;

  const mockProviderService = {
    getProvider: jest.fn(),
  };

  const mockUpstreamOidcService = {
    getInteractionByUid: jest.fn(),
    stagePendingUpstreamSession: jest.fn(),
    initiateUpstreamLogin: jest.fn(),
    handleUpstreamCallback: jest.fn(),
    setTenantUserIdForInteraction: jest.fn(),
    consumeInteraction: jest.fn(),
  };

  const mockOidcSessionRepository = {
    findInteractionByUid: jest.fn(),
    getSessionUidFromInteraction: jest.fn(),
  };

  const mockTenantUserService = {
    findById: jest.fn(),
    findByTenantAndExternalUserId: jest.fn(),
    findActiveByExternalUserId: jest.fn(),
    claimInvitedByEmail: jest.fn(),
    create: jest.fn(),
  };

  const mockRoleScopeService = {
    findScopesForRole: jest.fn(),
  };

  const mockClientLookup = {
    findActiveClient: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTenantUserService.findActiveByExternalUserId.mockResolvedValue([]);

    module = await Test.createTestingModule({
      controllers: [OidcInteractionController],
      providers: [
        {
          provide: OidcProviderService,
          useValue: mockProviderService,
        },
        {
          provide: OIDC_UPSTREAM_FEDERATION_PORT,
          useValue: mockUpstreamOidcService,
        },
        {
          provide: OIDC_TENANT_USER_PORT,
          useValue: mockTenantUserService,
        },
        {
          provide: OIDC_ROLE_SCOPE_PORT,
          useValue: mockRoleScopeService,
        },
        {
          provide: OIDC_CLIENT_LOOKUP_PORT,
          useValue: mockClientLookup,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: OidcSessionRepository,
          useValue: mockOidcSessionRepository,
        },
      ],
    }).compile();

    controller = module.get<OidcInteractionController>(
      OidcInteractionController,
    );
  });

  afterEach(async () => {
    await module.close();
  });

  describe('interaction - LOGIN prompt', () => {
    it('should handle login with consumed upstream interaction', async () => {
      const mockGrant = {
        addOIDCScope: jest.fn(),
        addResourceScope: jest.fn(),
        save: jest.fn().mockResolvedValue('grant-id'),
      };

      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: {
            name: 'login',
            details: {
              missingOIDCScope: ['openid', 'profile'],
              missingResourceScopes: { 'resource-1': ['read'] },
            },
          },
          params: { client_id: 'client-123' },
          session: null,
        }),
        Grant: jest.fn().mockImplementation(() => mockGrant),
        interactionFinished: jest.fn().mockResolvedValue(undefined),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);
      mockTenantUserService.findById.mockResolvedValue({
        id: 'user-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'User 123',
        role: 'member' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      });
      mockRoleScopeService.findScopesForRole.mockResolvedValue([]);

      const consumedInteraction = {
        id: 'interaction-123',
        state: 'state-123',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: 'user-123',
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: new Date(),
      };

      mockUpstreamOidcService.getInteractionByUid.mockResolvedValue(
        consumedInteraction,
      );

      const mockReq = {} as IncomingMessage;
      const mockRes = {
        headersSent: false,
        statusCode: 200,
      } as any;

      await controller.interaction(mockReq, mockRes);

      expect(mockProviderService.getProvider).toHaveBeenCalled();
      expect(mockUpstreamOidcService.getInteractionByUid).toHaveBeenCalledWith(
        'interaction-uid',
      );
      expect(mockProvider.interactionFinished).toHaveBeenCalledWith(
        mockReq,
        mockRes,
        {
          login: { accountId: 'user-123' },
          consent: { grantId: 'grant-id' },
        },
        { mergeWithLastSubmission: false },
      );
    });

    it('should start upstream login when no consumed interaction exists', async () => {
      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: { name: 'login' },
          params: { client_id: 'client-123' },
          session: null,
        }),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);
      mockUpstreamOidcService.getInteractionByUid.mockResolvedValue(null);
      mockConfigService.get.mockReturnValue('http://localhost:3000/oidc');
      mockClientLookup.findActiveClient.mockResolvedValue({
        clientId: 'client-123',
        clientSecretHash: 'secret-hash',
        name: 'Client',
        tenantId: 'tenant-123',
        scopes: ['openid'],
        redirectUris: ['http://localhost/callback'],
        grantTypes: ['authorization_code'],
      });

      const mockAuthUrl = new URL('http://keycloak:8080/auth?state=test');
      mockUpstreamOidcService.initiateUpstreamLogin.mockResolvedValue({
        state: 'test',
        authorizationUrl: mockAuthUrl,
      });

      const mockReq = {} as IncomingMessage;
      const mockRes = {
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.interaction(mockReq, mockRes);

      expect(
        mockUpstreamOidcService.initiateUpstreamLogin,
      ).toHaveBeenCalledWith(
        'interaction-uid',
        'tenant-123',
        'http://localhost:3000/oidc/callback',
      );
      expect(mockRes.statusCode).toBe(302);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Location',
        mockAuthUrl.href,
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should normalize trailing slash when building callback URL', async () => {
      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: { name: 'login' },
          params: { client_id: 'client-123' },
          session: null,
        }),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);
      mockUpstreamOidcService.getInteractionByUid.mockResolvedValue(null);
      mockConfigService.get.mockReturnValue('http://localhost:3000/oidc/');
      mockClientLookup.findActiveClient.mockResolvedValue({
        clientId: 'client-123',
        clientSecretHash: 'secret-hash',
        name: 'Client',
        tenantId: 'tenant-123',
        scopes: ['openid'],
        redirectUris: ['http://localhost/callback'],
        grantTypes: ['authorization_code'],
      });

      const mockAuthUrl = new URL('http://keycloak:8080/auth?state=test');
      mockUpstreamOidcService.initiateUpstreamLogin.mockResolvedValue({
        state: 'test',
        authorizationUrl: mockAuthUrl,
      });

      const mockReq = {} as IncomingMessage;
      const mockRes = {
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.interaction(mockReq, mockRes);

      expect(
        mockUpstreamOidcService.initiateUpstreamLogin,
      ).toHaveBeenCalledWith(
        'interaction-uid',
        'tenant-123',
        'http://localhost:3000/oidc/callback',
      );
    });

    it('should throw error when trying to login with existing session', async () => {
      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: { name: 'login' },
          params: { client_id: 'client-123' },
          session: { accountId: 'existing-account' },
        }),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);

      const mockReq = {} as IncomingMessage;
      const mockRes = {} as any;

      await expect(controller.interaction(mockReq, mockRes)).rejects.toThrow(
        'Attempted upstream login despite existing accountId existing-account',
      );
    });

    it('should throw error when client not found', async () => {
      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: { name: 'login' },
          params: { client_id: 'unknown-client' },
          session: null,
        }),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);
      mockUpstreamOidcService.getInteractionByUid.mockResolvedValue(null);
      mockClientLookup.findActiveClient.mockResolvedValue(undefined);

      const mockReq = {} as IncomingMessage;
      const mockRes = {} as any;

      await expect(controller.interaction(mockReq, mockRes)).rejects.toThrow(
        'OAuth client not found: unknown-client',
      );
    });
  });

  describe('interaction - CONSENT prompt', () => {
    it('should handle consent with authenticated session', async () => {
      const mockGrant = {
        addOIDCScope: jest.fn(),
        addResourceScope: jest.fn(),
        save: jest.fn().mockResolvedValue('grant-id'),
      };

      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: {
            name: 'consent',
            details: {
              missingOIDCScope: ['openid', 'profile'],
              missingResourceScopes: {
                'resource-1': ['read', 'write'],
              },
            },
          },
          params: { client_id: 'client-123' },
          session: { accountId: 'account-123' },
        }),
        Grant: jest.fn().mockImplementation(() => mockGrant),
        interactionFinished: jest.fn().mockResolvedValue(undefined),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);
      mockTenantUserService.findById.mockResolvedValue({
        id: 'account-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'member' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      });
      mockRoleScopeService.findScopesForRole.mockResolvedValue([
        'credentials:verify',
      ]);

      const mockReq = {} as IncomingMessage;
      const mockRes = {
        headersSent: false,
        statusCode: 200,
      } as any;

      await controller.interaction(mockReq, mockRes);

      expect(mockGrant.addOIDCScope).toHaveBeenCalledWith('openid profile');
      expect(mockGrant.addResourceScope).toHaveBeenCalledWith(
        'resource-1',
        'read write',
      );
      expect(mockGrant.save).toHaveBeenCalled();
      expect(mockProvider.interactionFinished).toHaveBeenCalledWith(
        mockReq,
        mockRes,
        { consent: { grantId: 'grant-id' } },
        { mergeWithLastSubmission: false },
      );
    });

    it('should throw error when no authenticated session', async () => {
      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: {
            name: 'consent',
            details: {
              missingOIDCScope: [],
              missingResourceScopes: {},
            },
          },
          params: { client_id: 'client-123' },
          session: null,
        }),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);

      const mockReq = {} as IncomingMessage;
      const mockRes = {} as any;

      await expect(controller.interaction(mockReq, mockRes)).rejects.toThrow(
        'No authenticated session',
      );
    });

    it('should handle consent without missing scopes', async () => {
      const mockGrant = {
        addOIDCScope: jest.fn(),
        addResourceScope: jest.fn(),
        save: jest.fn().mockResolvedValue('grant-id'),
      };

      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: {
            name: 'consent',
            details: {
              missingOIDCScope: null,
              missingResourceScopes: null,
            },
          },
          params: { client_id: 'client-123' },
          session: { accountId: 'account-123' },
        }),
        Grant: jest.fn().mockImplementation(() => mockGrant),
        interactionFinished: jest.fn().mockResolvedValue(undefined),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);

      const mockReq = {} as IncomingMessage;
      const mockRes = {
        headersSent: false,
        statusCode: 200,
      } as any;

      await controller.interaction(mockReq, mockRes);

      expect(mockGrant.addOIDCScope).not.toHaveBeenCalled();
      expect(mockGrant.addResourceScope).not.toHaveBeenCalled();
    });

    it('returns 403 when requested API scopes exceed the tenant-user role', async () => {
      const mockGrant = {
        addOIDCScope: jest.fn(),
        addResourceScope: jest.fn(),
        save: jest.fn().mockResolvedValue('grant-id'),
      };

      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: {
            name: 'consent',
            details: {
              missingOIDCScope: [
                'openid',
                'profile',
                'credentials:verify',
                'clients:manage',
              ],
              missingResourceScopes: null,
            },
          },
          params: { client_id: 'client-123' },
          session: { accountId: 'account-123' },
        }),
        Grant: jest.fn().mockImplementation(() => mockGrant),
        interactionFinished: jest.fn().mockResolvedValue(undefined),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);
      mockTenantUserService.findById.mockResolvedValue({
        id: 'account-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'member' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      });
      mockRoleScopeService.findScopesForRole.mockResolvedValue([
        'credentials:verify',
      ]);

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.interaction({} as IncomingMessage, mockRes);

      expect(mockRes.statusCode).toBe(403);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain',
      );
      expect(mockRes.end).toHaveBeenCalledWith(
        'Insufficient role for requested scopes: Requested scopes exceed tenant-user role &quot;member&quot;: clients:manage',
      );
      expect(mockGrant.addOIDCScope).not.toHaveBeenCalled();
      expect(mockGrant.addResourceScope).not.toHaveBeenCalled();
      expect(mockGrant.save).not.toHaveBeenCalled();
      expect(mockProvider.interactionFinished).not.toHaveBeenCalled();
    });
  });

  describe('interaction - unsupported prompt', () => {
    it('should throw error for unsupported prompt type', async () => {
      const mockProvider = {
        interactionDetails: jest.fn().mockResolvedValue({
          uid: 'interaction-uid',
          prompt: { name: 'unknown-prompt' },
        }),
      };

      mockProviderService.getProvider.mockReturnValue(mockProvider);

      const mockReq = {} as IncomingMessage;
      const mockRes = {} as any;

      await expect(controller.interaction(mockReq, mockRes)).rejects.toThrow(
        'Unsupported oidc-provider interaction prompt: unknown-prompt',
      );
    });
  });

  describe('callback', () => {
    it('should handle upstream callback successfully', async () => {
      const mockInteraction = {
        id: 'interaction-123',
        state: 'state-123',
        nonce: 'nonce-123',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: null,
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: null,
      };

      mockUpstreamOidcService.handleUpstreamCallback.mockResolvedValue({
        claims: {
          sub: 'external-user-123',
          email: 'user@example.com',
          name: 'Test User',
        },
        interaction: mockInteraction,
        upstreamSession: {
          upstreamSubject: 'external-user-123',
          upstreamIdToken: 'upstream-id-token',
          expiresAt: null,
        },
      });
      mockOidcSessionRepository.findInteractionByUid.mockResolvedValue({
        id: 'interaction-model-123',
        uid: 'session-uid-123',
        payload: {},
      });
      mockOidcSessionRepository.getSessionUidFromInteraction.mockReturnValue(
        'session-uid-123',
      );

      const mockFederatedUser = {
        id: 'local-user-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'readonly' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      };

      mockTenantUserService.findByTenantAndExternalUserId.mockResolvedValue(
        mockFederatedUser,
      );
      mockUpstreamOidcService.setTenantUserIdForInteraction.mockResolvedValue(
        mockInteraction,
      );
      mockUpstreamOidcService.consumeInteraction.mockResolvedValue(
        mockInteraction,
      );

      mockConfigService.get.mockReturnValue('http://localhost:3000/oidc');

      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(
        mockUpstreamOidcService.handleUpstreamCallback,
      ).toHaveBeenCalledWith('state-123', 'auth-code', expect.any(URL));
      expect(
        mockTenantUserService.findByTenantAndExternalUserId,
      ).toHaveBeenCalledWith('tenant-123', 'external-user-123');
      expect(
        mockUpstreamOidcService.stagePendingUpstreamSession,
      ).toHaveBeenCalledWith({
        tenantUserId: 'local-user-123',
        upstreamSubject: 'external-user-123',
        upstreamIdToken: 'upstream-id-token',
        expiresAt: null,
      });
      expect(
        mockUpstreamOidcService.setTenantUserIdForInteraction,
      ).toHaveBeenCalledWith('state-123', 'local-user-123');
      expect(mockUpstreamOidcService.consumeInteraction).toHaveBeenCalledWith(
        'state-123',
      );
      expect(mockRes.statusCode).toBe(302);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Location',
        'http://localhost:3000/oidc/interaction/interaction-uid',
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should normalize trailing slash when building interaction redirect URL', async () => {
      const mockInteraction = {
        id: 'interaction-123',
        state: 'state-123',
        nonce: 'nonce-123',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: null,
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: null,
      };

      mockUpstreamOidcService.handleUpstreamCallback.mockResolvedValue({
        claims: {
          sub: 'external-user-123',
          email: 'user@example.com',
          name: 'Test User',
        },
        interaction: mockInteraction,
        upstreamSession: {
          upstreamSubject: 'external-user-123',
          upstreamIdToken: 'upstream-id-token',
          expiresAt: null,
        },
      });
      mockOidcSessionRepository.findInteractionByUid.mockResolvedValue({
        id: 'interaction-model-123',
        uid: 'session-uid-123',
        payload: {},
      });
      mockOidcSessionRepository.getSessionUidFromInteraction.mockReturnValue(
        'session-uid-123',
      );

      const mockFederatedUser = {
        id: 'local-user-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'readonly' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      };

      mockTenantUserService.findByTenantAndExternalUserId.mockResolvedValue(
        mockFederatedUser,
      );
      mockUpstreamOidcService.setTenantUserIdForInteraction.mockResolvedValue(
        mockInteraction,
      );
      mockUpstreamOidcService.consumeInteraction.mockResolvedValue(
        mockInteraction,
      );

      mockConfigService.get.mockReturnValue('http://localhost:3000/oidc/');

      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Location',
        'http://localhost:3000/oidc/interaction/interaction-uid',
      );
    });

    it('should create new user if federated user does not exist', async () => {
      const mockInteraction = {
        id: 'interaction-123',
        state: 'state-123',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: null,
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: null,
      };

      mockUpstreamOidcService.handleUpstreamCallback.mockResolvedValue({
        claims: {
          sub: 'external-user-new',
          email: 'newuser@example.com',
          name: 'New User',
        },
        interaction: mockInteraction,
        upstreamSession: {
          upstreamSubject: 'external-user-new',
          upstreamIdToken: 'upstream-id-token',
          expiresAt: null,
        },
      });
      mockOidcSessionRepository.findInteractionByUid.mockResolvedValue({
        id: 'interaction-model-123',
        uid: 'session-uid-123',
        payload: {},
      });
      mockOidcSessionRepository.getSessionUidFromInteraction.mockReturnValue(
        'session-uid-123',
      );

      mockTenantUserService.findByTenantAndExternalUserId.mockResolvedValue(
        null,
      );
      mockTenantUserService.claimInvitedByEmail.mockResolvedValue(null);

      const mockNewUser = {
        id: 'local-user-new',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-new',
        email: 'newuser@example.com',
        displayName: 'New User',
        role: 'readonly' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      };

      mockTenantUserService.create.mockResolvedValue(mockNewUser);
      mockUpstreamOidcService.setTenantUserIdForInteraction.mockResolvedValue(
        mockInteraction,
      );
      mockUpstreamOidcService.consumeInteraction.mockResolvedValue(
        mockInteraction,
      );

      mockConfigService.get.mockReturnValue('http://localhost:3000/oidc');

      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(mockTenantUserService.claimInvitedByEmail).toHaveBeenCalledWith(
        'tenant-123',
        'newuser@example.com',
        'external-user-new',
      );
      expect(mockTenantUserService.create).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        externalUserId: 'external-user-new',
        email: 'newuser@example.com',
        displayName: 'New User',
        role: 'readonly',
        status: 'active',
      });
    });

    it('should claim an invited tenant user by email instead of creating a new one', async () => {
      const mockInteraction = {
        id: 'interaction-123',
        state: 'state-123',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: null,
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: null,
      };

      mockUpstreamOidcService.handleUpstreamCallback.mockResolvedValue({
        claims: {
          sub: 'external-user-invited',
          email: 'invited@example.com',
          name: 'Invited User',
        },
        interaction: mockInteraction,
        upstreamSession: {
          upstreamSubject: 'external-user-invited',
          upstreamIdToken: 'upstream-id-token',
          expiresAt: null,
        },
      });
      mockOidcSessionRepository.findInteractionByUid.mockResolvedValue({
        id: 'interaction-model-123',
        uid: 'session-uid-123',
        payload: {},
      });
      mockOidcSessionRepository.getSessionUidFromInteraction.mockReturnValue(
        'session-uid-123',
      );

      mockTenantUserService.findByTenantAndExternalUserId.mockResolvedValue(
        null,
      );

      const mockClaimedUser = {
        id: 'local-user-invited',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-invited',
        email: 'invited@example.com',
        displayName: undefined,
        role: 'admin' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      };

      mockTenantUserService.claimInvitedByEmail.mockResolvedValue(
        mockClaimedUser,
      );
      mockUpstreamOidcService.setTenantUserIdForInteraction.mockResolvedValue(
        mockInteraction,
      );
      mockUpstreamOidcService.consumeInteraction.mockResolvedValue(
        mockInteraction,
      );

      mockConfigService.get.mockReturnValue('http://localhost:3000/oidc');

      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(mockTenantUserService.claimInvitedByEmail).toHaveBeenCalledWith(
        'tenant-123',
        'invited@example.com',
        'external-user-invited',
      );
      expect(mockTenantUserService.create).not.toHaveBeenCalled();
      expect(
        mockUpstreamOidcService.stagePendingUpstreamSession,
      ).toHaveBeenCalledWith({
        tenantUserId: 'local-user-invited',
        upstreamSubject: 'external-user-invited',
        upstreamIdToken: 'upstream-id-token',
        expiresAt: null,
      });
    });

    it('should bind the oldest active membership when the user belongs to multiple tenants', async () => {
      const mockInteraction = {
        id: 'interaction-123',
        state: 'state-123',
        nonce: 'nonce-123',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'spa-client-tenant',
        tenantUserId: null,
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: null,
      };

      mockUpstreamOidcService.handleUpstreamCallback.mockResolvedValue({
        claims: {
          sub: 'external-user-123',
          email: 'user@example.com',
          name: 'Test User',
        },
        interaction: mockInteraction,
        upstreamSession: {
          upstreamSubject: 'external-user-123',
          upstreamIdToken: 'upstream-id-token',
          expiresAt: null,
        },
      });

      const firstMembership = {
        id: 'older-membership',
        tenantId: 'tenant-older',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'admin' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      };
      const laterMembership = {
        id: 'newer-membership',
        tenantId: 'spa-client-tenant',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'member' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      };

      mockTenantUserService.findActiveByExternalUserId.mockResolvedValue([
        firstMembership,
        laterMembership,
      ]);
      mockUpstreamOidcService.setTenantUserIdForInteraction.mockResolvedValue(
        mockInteraction,
      );
      mockUpstreamOidcService.consumeInteraction.mockResolvedValue(
        mockInteraction,
      );
      mockConfigService.get.mockReturnValue('http://localhost:3000/oidc');

      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(
        mockTenantUserService.findActiveByExternalUserId,
      ).toHaveBeenCalledWith('external-user-123');
      expect(
        mockTenantUserService.findByTenantAndExternalUserId,
      ).not.toHaveBeenCalled();
      expect(mockTenantUserService.create).not.toHaveBeenCalled();
      expect(
        mockUpstreamOidcService.setTenantUserIdForInteraction,
      ).toHaveBeenCalledWith('state-123', 'older-membership');
    });

    it('should return 400 when upstream error occurs', async () => {
      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback?error=invalid_request&error_description=Bad+request',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        undefined,
        undefined,
        'nonce-123',
        'invalid_request',
        'Bad request',
        mockReq,
        mockRes,
      );

      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain',
      );
      expect(mockRes.end).toHaveBeenCalledWith(
        'Upstream OIDC error: invalid_request\nBad request',
      );
    });

    it('should return 400 when code or state is missing', async () => {
      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        undefined,
        undefined,
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.end).toHaveBeenCalledWith(
        'Missing code or state in upstream callback',
      );
    });

    it('should handle callback exception and return 400', async () => {
      mockUpstreamOidcService.handleUpstreamCallback.mockRejectedValue(
        new Error('Token exchange failed'),
      );

      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.end).toHaveBeenCalledWith(
        'Error processing callback: Token exchange failed',
      );
    });

    it('should not modify response when headers already sent', async () => {
      mockUpstreamOidcService.handleUpstreamCallback.mockRejectedValue(
        new Error('Token exchange failed'),
      );

      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as IncomingMessage;

      const mockRes = {
        headersSent: true,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(mockRes.end).not.toHaveBeenCalled();
      expect(mockRes.statusCode).toBe(200);
    });

    it('should use default OIDC_ISSUER if not configured', async () => {
      const mockInteraction = {
        id: 'interaction-123',
        state: 'state-123',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: null,
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: null,
      };

      mockUpstreamOidcService.handleUpstreamCallback.mockResolvedValue({
        claims: {
          sub: 'external-user-123',
          email: 'user@example.com',
          name: 'Test User',
        },
        interaction: mockInteraction,
        upstreamSession: {
          upstreamSubject: 'external-user-123',
          upstreamIdToken: 'upstream-id-token',
          expiresAt: null,
        },
      });
      mockOidcSessionRepository.findInteractionByUid.mockResolvedValue({
        id: 'interaction-model-123',
        uid: 'session-uid-123',
        payload: {},
      });
      mockOidcSessionRepository.getSessionUidFromInteraction.mockReturnValue(
        'session-uid-123',
      );

      const mockFederatedUser = {
        id: 'local-user-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'readonly' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      };

      mockTenantUserService.findByTenantAndExternalUserId.mockResolvedValue(
        mockFederatedUser,
      );
      mockUpstreamOidcService.setTenantUserIdForInteraction.mockResolvedValue(
        mockInteraction,
      );
      mockUpstreamOidcService.consumeInteraction.mockResolvedValue(
        mockInteraction,
      );

      // ConfigService returns default value
      mockConfigService.get.mockReturnValue('http://localhost:3000/oidc');

      const mockReq = {
        headers: { host: 'localhost:3000' },
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(mockConfigService.get).toHaveBeenCalledWith(
        'OIDC_ISSUER',
        'http://localhost:3000/oidc',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Location',
        'http://localhost:3000/oidc/interaction/interaction-uid',
      );
    });

    it('should handle x-forwarded-proto header correctly', async () => {
      const mockInteraction = {
        id: 'interaction-123',
        state: 'state-123',
        nonce: 'nonce-123',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: null,
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: null,
      };

      mockUpstreamOidcService.handleUpstreamCallback.mockResolvedValue({
        claims: {
          sub: 'external-user-123',
          email: 'user@example.com',
          name: 'Test User',
        },
        interaction: mockInteraction,
        upstreamSession: {
          upstreamSubject: 'external-user-123',
          upstreamIdToken: 'upstream-id-token',
          expiresAt: null,
        },
      });
      mockOidcSessionRepository.findInteractionByUid.mockResolvedValue({
        id: 'interaction-model-123',
        uid: 'session-uid-123',
        payload: {},
      });
      mockOidcSessionRepository.getSessionUidFromInteraction.mockReturnValue(
        'session-uid-123',
      );

      const mockFederatedUser = {
        id: 'local-user-123',
        tenantId: 'tenant-123',
        externalUserId: 'external-user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'readonly' as OidcTenantUserRole,
        status: 'active' as OidcTenantUserStatus,
      };

      mockTenantUserService.findByTenantAndExternalUserId.mockResolvedValue(
        mockFederatedUser,
      );
      mockUpstreamOidcService.setTenantUserIdForInteraction.mockResolvedValue(
        mockInteraction,
      );
      mockUpstreamOidcService.consumeInteraction.mockResolvedValue(
        mockInteraction,
      );

      mockConfigService.get.mockReturnValue('http://localhost:3000/oidc');

      const mockReq = {
        headers: {
          host: 'localhost:3000',
          'x-forwarded-proto': 'https, http',
        },
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as unknown as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(
        mockUpstreamOidcService.handleUpstreamCallback,
      ).toHaveBeenCalledWith(
        'state-123',
        'auth-code',
        expect.objectContaining({
          protocol: 'https:',
        }),
      );
    });

    it('should throw error when missing host header', async () => {
      mockUpstreamOidcService.handleUpstreamCallback.mockImplementation(
        (_state, _code) => {
          // This will be called with an invalid URL
          throw new Error('Missing Host header');
        },
      );

      const mockReq = {
        headers: {},
        url: '/oidc/callback?code=auth-code&state=state-123',
      } as IncomingMessage;

      const mockRes = {
        headersSent: false,
        statusCode: 200,
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.callback(
        'auth-code',
        'state-123',
        'nonce-123',
        undefined,
        undefined,
        mockReq,
        mockRes,
      );

      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.end).toHaveBeenCalledWith(
        'Error processing callback: Missing Host header',
      );
    });
  });
});
