/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('fs');
jest.mock('openid-client', () => ({
  discovery: jest.fn(),
  randomPKCECodeVerifier: jest.fn(),
  calculatePKCECodeChallenge: jest.fn(),
  randomState: jest.fn(),
  randomNonce: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  buildEndSessionUrl: jest.fn(),
  authorizationCodeGrant: jest.fn(),
}));

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { OidcUpstreamInteraction } from './oidc-upstream-interaction.entity';
import { OidcUpstreamInteractionRepository } from './oidc-upstream-interaction.repository';
import { OidcUpstreamSessionRepository } from './oidc-upstream-session.repository';
import { UpstreamOidcService } from './oidc-upstream.service';

const mockConfigService = {
  get: jest.fn(),
};

const mockInteractionRepository = {
  create: jest.fn(),
  upsertByInteractionUid: jest.fn(),
  findByState: jest.fn(),
  findByInteractionUid: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findExpiredInteractions: jest.fn(),
};

const mockSessionRepository = {
  createPending: jest.fn(),
  findLatestPendingByTenantUserId: jest.fn(),
  findByOidcModelId: jest.fn(),
  findByOidcSessionUid: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('UpstreamOidcService', () => {
  let service: UpstreamOidcService;
  let module: TestingModule;
  let originalFetch: typeof global.fetch | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    originalFetch = global.fetch;
    global.fetch = jest.fn();

    module = await Test.createTestingModule({
      providers: [
        UpstreamOidcService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: OidcUpstreamInteractionRepository,
          useValue: mockInteractionRepository,
        },
        {
          provide: OidcUpstreamSessionRepository,
          useValue: mockSessionRepository,
        },
      ],
    }).compile();

    service = module.get<UpstreamOidcService>(UpstreamOidcService);
  });

  afterEach(async () => {
    global.fetch = originalFetch as typeof global.fetch;
    await module?.close();
  });

  describe('onModuleInit', () => {
    it('should initialize config successfully', async () => {
      const mockConfig = { issuer: 'http://localhost:8080' };
      mockConfigService.get.mockReturnValue(
        '/path/to/upstream-identity-federation.json',
      );

      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          url: 'http://localhost:8080',
          clientId: 'test-client',
        }),
      );

      const oidc = require('openid-client');
      oidc.discovery.mockResolvedValue(mockConfig);

      await service.onModuleInit();

      expect(service.getConfig()).toEqual(mockConfig);
    });

    it('should throw error if config path is not set', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(service.onModuleInit()).rejects.toThrow(
        'UPSTREAM_IDENTITY_FEDERATION_CONFIG_PATH environment variable is not set.',
      );
    });

    it('should throw error if config file does not exist', async () => {
      mockConfigService.get.mockReturnValue(
        '/path/to/upstream-identity-federation.json',
      );

      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);

      await expect(service.onModuleInit()).rejects.toThrow(
        'Upstream OIDC config file does not exist',
      );
    });

    it('should throw error if config file is invalid JSON', async () => {
      mockConfigService.get.mockReturnValue(
        '/path/to/upstream-identity-federation.json',
      );

      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json');

      await expect(service.onModuleInit()).rejects.toThrow(
        'Unable to load upstream OIDC configuration',
      );
    });
  });

  describe('getConfig', () => {
    it('should throw error if config not initialized', () => {
      expect(() => service.getConfig()).toThrow('OIDC config not initialized.');
    });

    it('should return config if initialized', async () => {
      const mockConfig = { issuer: 'http://localhost:8080' };
      mockConfigService.get.mockReturnValue(
        '/path/to/upstream-identity-federation.json',
      );

      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          url: 'http://localhost:8080',
          clientId: 'test-client',
        }),
      );

      const oidc = require('openid-client');
      oidc.discovery.mockResolvedValue(mockConfig);

      await service.onModuleInit();

      expect(service.getConfig()).toEqual(mockConfig);
    });
  });

  describe('storeInteraction', () => {
    it('should store interaction with default TTL', async () => {
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: undefined,
      };

      mockInteractionRepository.upsertByInteractionUid.mockResolvedValue(
        mockInteraction,
      );

      const result = await service.storeInteraction(
        'test-state',
        'nonce',
        'verifier',
        'interaction-uid',
        'tenant-123',
      );

      expect(result).toEqual(mockInteraction);
      expect(
        mockInteractionRepository.upsertByInteractionUid,
      ).toHaveBeenCalled();
    });

    it('should store interaction with custom TTL', async () => {
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        consumedAt: undefined,
      };

      mockInteractionRepository.upsertByInteractionUid.mockResolvedValue(
        mockInteraction,
      );

      const result = await service.storeInteraction(
        'test-state',
        'nonce',
        'verifier',
        'interaction-uid',
        'tenant-123',
        'user-123',
        30,
      );

      expect(result).toEqual(mockInteraction);
    });
  });

  describe('validateInteraction', () => {
    it('should return interaction if valid and not expired', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: futureDate,
        consumedAt: undefined,
      };

      mockInteractionRepository.findByState.mockResolvedValue(mockInteraction);

      const result = await service.validateInteraction('test-state');

      expect(result).toEqual(mockInteraction);
    });

    it('should throw error if interaction not found', async () => {
      mockInteractionRepository.findByState.mockResolvedValue(null);

      await expect(
        service.validateInteraction('invalid-state'),
      ).rejects.toThrow('Interaction not found for state');
    });

    it('should throw error if interaction is expired', async () => {
      const pastDate = new Date(Date.now() - 10 * 60 * 1000);
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: pastDate,
        consumedAt: undefined,
      };

      mockInteractionRepository.findByState.mockResolvedValue(mockInteraction);

      await expect(service.validateInteraction('test-state')).rejects.toThrow(
        'Interaction has expired',
      );
    });
  });

  describe('consumeInteraction', () => {
    it('should mark interaction as consumed', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: futureDate,
        consumedAt: undefined,
      };

      const consumedInteraction = {
        ...mockInteraction,
        consumedAt: new Date(),
      };

      mockInteractionRepository.findByState.mockResolvedValue(mockInteraction);
      mockInteractionRepository.update.mockResolvedValue(consumedInteraction);

      const result = await service.consumeInteraction('test-state');

      expect(result.consumedAt).toBeDefined();
      expect(mockInteractionRepository.update).toHaveBeenCalled();
    });
  });

  describe('getInteractionByState', () => {
    it('should return interaction if found', async () => {
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: undefined,
      };

      mockInteractionRepository.findByState.mockResolvedValue(mockInteraction);

      const result = await service.getInteractionByState('test-state');

      expect(result).toEqual(mockInteraction);
    });

    it('should return null if interaction not found', async () => {
      mockInteractionRepository.findByState.mockResolvedValue(null);

      const result = await service.getInteractionByState('invalid-state');

      expect(result).toBeNull();
    });
  });

  describe('getInteractionByUid', () => {
    it('should return interaction if found', async () => {
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: new Date(),
        consumedAt: undefined,
      };

      mockInteractionRepository.findByInteractionUid.mockResolvedValue(
        mockInteraction,
      );

      const result = await service.getInteractionByUid('interaction-uid');

      expect(result).toEqual(mockInteraction);
    });

    it('should return null if interaction not found', async () => {
      mockInteractionRepository.findByInteractionUid.mockResolvedValue(null);

      const result = await service.getInteractionByUid('invalid-uid');

      expect(result).toBeNull();
    });
  });

  describe('setTenantUserIdForInteraction', () => {
    it('should set tenant user id for interaction', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: futureDate,
        consumedAt: undefined,
      };

      const updatedInteraction = {
        ...mockInteraction,
        tenantUserId: 'user-123',
      };

      mockInteractionRepository.findByState.mockResolvedValue(mockInteraction);
      mockInteractionRepository.update.mockResolvedValue(updatedInteraction);

      const result = await service.setTenantUserIdForInteraction(
        'test-state',
        'user-123',
      );

      expect(result.tenantUserId).toBe('user-123');
      expect(mockInteractionRepository.update).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredInteractions', () => {
    it('should delete all expired interactions', async () => {
      const expiredInteractions: OidcUpstreamInteraction[] = [
        {
          id: '1',
          state: 'state-1',
          interactionUid: 'uid-1',
          codeVerifier: 'verifier-1',
          tenantId: 'tenant-123',
          tenantUserId: undefined,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() - 1000),
          consumedAt: undefined,
          nonce: 'nonce-1',
        },
        {
          id: '2',
          state: 'state-2',
          interactionUid: 'uid-2',
          codeVerifier: 'verifier-2',
          tenantId: 'tenant-123',
          tenantUserId: undefined,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() - 1000),
          consumedAt: undefined,
          nonce: 'nonce-2',
        },
      ];

      mockInteractionRepository.findExpiredInteractions.mockResolvedValue(
        expiredInteractions,
      );
      mockInteractionRepository.delete.mockResolvedValue(undefined);

      const result = await service.cleanupExpiredInteractions();

      expect(result).toBe(2);
      expect(mockInteractionRepository.delete).toHaveBeenCalledTimes(2);
    });

    it('should return 0 if no expired interactions', async () => {
      mockInteractionRepository.findExpiredInteractions.mockResolvedValue([]);

      const result = await service.cleanupExpiredInteractions();

      expect(result).toBe(0);
      expect(mockInteractionRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('initiateUpstreamLogin', () => {
    it('should initiate upstream login flow', async () => {
      const mockConfig = {
        issuer: 'http://localhost:8080',
        authorization_endpoint: 'http://localhost:8080/auth',
      };

      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: undefined,
      };

      mockConfigService.get.mockReturnValue(
        '/path/to/upstream-identity-federation.json',
      );

      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          url: 'http://localhost:8080',
          clientId: 'test-client',
        }),
      );

      const oidc = require('openid-client');
      oidc.discovery.mockResolvedValue(mockConfig);
      oidc.randomPKCECodeVerifier.mockReturnValue('verifier');
      oidc.calculatePKCECodeChallenge.mockResolvedValue('challenge');
      oidc.randomState.mockReturnValue('test-state');
      oidc.buildAuthorizationUrl.mockReturnValue(
        new URL('http://localhost:8080/auth?state=test-state'),
      );

      mockInteractionRepository.upsertByInteractionUid.mockResolvedValue(
        mockInteraction,
      );

      await service.onModuleInit();

      const result = await service.initiateUpstreamLogin(
        'interaction-uid',
        'tenant-123',
        'http://localhost:3000/callback',
      );

      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('authorizationUrl');
      expect(
        mockInteractionRepository.upsertByInteractionUid,
      ).toHaveBeenCalled();
    });
  });

  describe('handleUpstreamCallback', () => {
    it('should handle upstream callback and return claims', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: futureDate,
        consumedAt: undefined,
      };

      const mockConfig = {
        issuer: 'http://localhost:8080',
      };

      const mockClaims = {
        sub: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
      };

      mockInteractionRepository.findByState.mockResolvedValue(mockInteraction);

      mockConfigService.get.mockReturnValue(
        '/path/to/upstream-identity-federation.json',
      );

      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          url: 'http://localhost:8080',
          clientId: 'test-client',
        }),
      );

      const oidc = require('openid-client');
      oidc.discovery.mockResolvedValue(mockConfig);

      const mockTokens = {
        id_token: 'upstream-id-token',
        claims: jest.fn().mockReturnValue(mockClaims),
      };

      oidc.authorizationCodeGrant.mockResolvedValue(mockTokens);

      await service.onModuleInit();

      const result = await service.handleUpstreamCallback(
        'test-state',
        'auth-code',
        new URL(
          'http://localhost:3000/oidc/callback?code=auth-code&state=test-state',
        ),
      );

      expect(result.claims.sub).toBe('user-123');
      expect(result.claims.email).toBe('user@example.com');
      expect(result.claims.name).toBe('Test User');
      expect(result.interaction).toEqual(mockInteraction);
      expect(result.upstreamSession).toEqual({
        upstreamSubject: 'user-123',
        upstreamIdToken: 'upstream-id-token',
        expiresAt: null,
      });
    });

    it('should throw error if claims are missing sub', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: futureDate,
        consumedAt: undefined,
      };

      const mockConfig = {
        issuer: 'http://localhost:8080',
      };

      const invalidClaims = {
        email: 'user@example.com',
      };

      mockInteractionRepository.findByState.mockResolvedValue(mockInteraction);

      mockConfigService.get.mockReturnValue(
        '/path/to/upstream-identity-federation.json',
      );

      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          url: 'http://localhost:8080',
          clientId: 'test-client',
        }),
      );

      const oidc = require('openid-client');
      oidc.discovery.mockResolvedValue(mockConfig);

      const mockTokens = {
        id_token: 'upstream-id-token',
        claims: jest.fn().mockReturnValue(invalidClaims),
      };

      oidc.authorizationCodeGrant.mockResolvedValue(mockTokens);

      await service.onModuleInit();

      await expect(
        service.handleUpstreamCallback(
          'test-state',
          'auth-code',
          new URL(
            'http://localhost:3000/oidc/callback?code=auth-code&state=test-state',
          ),
        ),
      ).rejects.toThrow('Invalid or missing sub claim in ID token');
    });

    it('should validate expectedNonce and reject mismatched nonce', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'correct-nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: futureDate,
        consumedAt: undefined,
      };

      const mockConfig = {
        issuer: 'http://localhost:8080',
      };

      mockInteractionRepository.findByState.mockResolvedValue(mockInteraction);

      mockConfigService.get.mockReturnValue(
        '/path/to/upstream-identity-federation.json',
      );

      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          url: 'http://localhost:8080',
          clientId: 'test-client',
        }),
      );

      const oidc = require('openid-client');
      oidc.discovery.mockResolvedValue(mockConfig);

      // Simulate authorizationCodeGrant throwing error for nonce mismatch
      oidc.authorizationCodeGrant.mockRejectedValue(
        new Error('nonce mismatch'),
      );

      await service.onModuleInit();

      await expect(
        service.handleUpstreamCallback(
          'test-state',
          'auth-code',
          new URL(
            'http://localhost:3000/oidc/callback?code=auth-code&state=test-state',
          ),
        ),
      ).rejects.toThrow('nonce mismatch');

      // Verify that authorizationCodeGrant was called with expectedNonce
      expect(oidc.authorizationCodeGrant).toHaveBeenCalledWith(
        mockConfig,
        expect.any(URL),
        expect.objectContaining({
          expectedNonce: mockInteraction.nonce,
          expectedState: mockInteraction.state,
          pkceCodeVerifier: mockInteraction.codeVerifier,
        }),
      );
    });

    it('should throw error if the upstream provider does not return an ID token', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const mockInteraction: OidcUpstreamInteraction = {
        id: '123',
        state: 'test-state',
        nonce: 'nonce',
        interactionUid: 'interaction-uid',
        codeVerifier: 'verifier',
        tenantId: 'tenant-123',
        tenantUserId: undefined,
        createdAt: new Date(),
        expiresAt: futureDate,
        consumedAt: undefined,
      };

      mockInteractionRepository.findByState.mockResolvedValue(mockInteraction);
      mockConfigService.get.mockReturnValue(
        '/path/to/upstream-identity-federation.json',
      );

      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          url: 'http://localhost:8080',
          clientId: 'test-client',
        }),
      );

      const oidc = require('openid-client');
      oidc.discovery.mockResolvedValue({ issuer: 'http://localhost:8080' });
      oidc.authorizationCodeGrant.mockResolvedValue({
        claims: jest.fn().mockReturnValue({ sub: 'user-123' }),
      });

      await service.onModuleInit();

      await expect(
        service.handleUpstreamCallback(
          'test-state',
          'auth-code',
          new URL(
            'http://localhost:3000/oidc/callback?code=auth-code&state=test-state',
          ),
        ),
      ).rejects.toThrow(
        'Missing ID token from upstream authorization code grant',
      );
    });
  });

  describe('stagePendingUpstreamSession', () => {
    it('should stage the pending upstream session for the tenant user', async () => {
      mockSessionRepository.createPending.mockResolvedValue({});

      await service.stagePendingUpstreamSession({
        tenantUserId: 'tenant-user-123',
        upstreamSubject: 'upstream-user-123',
        upstreamIdToken: 'id-token',
        expiresAt: null,
      });

      expect(mockSessionRepository.createPending).toHaveBeenCalledWith({
        tenantUserId: 'tenant-user-123',
        upstreamSubject: 'upstream-user-123',
        upstreamIdToken: 'id-token',
        expiresAt: null,
      });
    });
  });

  describe('finalizeUpstreamSessionForOidcSession', () => {
    it('should finalize a pending upstream session when tenant user matches', async () => {
      const pendingSession = {
        id: 'session-123',
        oidcModelId: null,
        oidcSessionUid: 'session-uid',
        tenantUserId: 'tenant-user-123',
        upstreamSubject: 'upstream-user-123',
        upstreamIdToken: 'id-token',
        expiresAt: null,
      };

      mockSessionRepository.findLatestPendingByTenantUserId.mockResolvedValue(
        pendingSession,
      );
      mockSessionRepository.findByOidcSessionUid.mockResolvedValue(null);
      mockSessionRepository.update.mockImplementation(
        async (session) => await new Promise((resolve) => resolve(session)),
      );

      const result = await service.finalizeUpstreamSessionForOidcSession({
        oidcModelId: 'oidc-model-123',
        oidcSessionUid: 'session-uid',
        tenantUserId: 'tenant-user-123',
      });

      expect(
        mockSessionRepository.findLatestPendingByTenantUserId,
      ).toHaveBeenCalledWith('tenant-user-123');
      expect(mockSessionRepository.update).toHaveBeenCalledWith({
        ...pendingSession,
        oidcModelId: 'oidc-model-123',
        oidcSessionUid: 'session-uid',
      });
      expect(result).toEqual({
        ...pendingSession,
        oidcModelId: 'oidc-model-123',
        oidcSessionUid: 'session-uid',
      });
    });

    it('should merge into an existing finalized session for the same oidc session uid', async () => {
      const pendingSession = {
        id: 'pending-session-123',
        oidcModelId: null,
        oidcSessionUid: null,
        tenantUserId: 'tenant-user-123',
        upstreamSubject: 'new-upstream-user-123',
        upstreamIdToken: 'new-id-token',
        expiresAt: new Date('2026-08-19T00:00:00.000Z'),
      };
      const existingSession = {
        id: 'finalized-session-123',
        oidcModelId: 'old-oidc-model-id',
        oidcSessionUid: 'session-uid',
        tenantUserId: 'tenant-user-123',
        upstreamSubject: 'old-upstream-user-123',
        upstreamIdToken: 'old-id-token',
        expiresAt: null,
      };

      mockSessionRepository.findLatestPendingByTenantUserId.mockResolvedValue(
        pendingSession,
      );
      mockSessionRepository.findByOidcSessionUid.mockResolvedValue(
        existingSession,
      );
      mockSessionRepository.update.mockImplementation(
        async (session) => await new Promise((resolve) => resolve(session)),
      );

      const result = await service.finalizeUpstreamSessionForOidcSession({
        oidcModelId: 'oidc-model-123',
        oidcSessionUid: 'session-uid',
        tenantUserId: 'tenant-user-123',
      });

      expect(mockSessionRepository.update).toHaveBeenCalledWith({
        ...existingSession,
        oidcModelId: 'oidc-model-123',
        tenantUserId: 'tenant-user-123',
        upstreamSubject: 'new-upstream-user-123',
        upstreamIdToken: 'new-id-token',
        expiresAt: new Date('2026-08-19T00:00:00.000Z'),
      });
      expect(mockSessionRepository.delete).toHaveBeenCalledWith(
        'pending-session-123',
      );
      expect(result).toEqual({
        ...existingSession,
        oidcModelId: 'oidc-model-123',
        tenantUserId: 'tenant-user-123',
        upstreamSubject: 'new-upstream-user-123',
        upstreamIdToken: 'new-id-token',
        expiresAt: new Date('2026-08-19T00:00:00.000Z'),
      });
    });
  });

  describe('logoutUpstreamSessionForOidcSession', () => {
    it('should log out the finalized upstream session and then delete it locally', async () => {
      (service as any).config = {
        issuer: 'http://localhost:8080',
      };

      mockSessionRepository.findByOidcModelId.mockResolvedValue({
        id: 'upstream-session-123',
        upstreamIdToken: 'stored-id-token',
      });

      const oidc = require('openid-client');
      oidc.buildEndSessionUrl.mockReturnValue(
        new URL('http://localhost:8080/logout?id_token_hint=stored-id-token'),
      );
      (global.fetch as jest.Mock).mockResolvedValue({ status: 302 });

      await service.logoutUpstreamSessionForOidcSession({
        oidcModelId: 'oidc-model-123',
        oidcSessionUid: 'session-uid-123',
      });

      expect(mockSessionRepository.findByOidcModelId).toHaveBeenCalledWith(
        'oidc-model-123',
      );
      expect(oidc.buildEndSessionUrl).toHaveBeenCalledWith(
        service.getConfig(),
        { id_token_hint: 'stored-id-token' },
      );
      expect(global.fetch).toHaveBeenCalledWith(
        new URL('http://localhost:8080/logout?id_token_hint=stored-id-token'),
        {
          method: 'GET',
          redirect: 'manual',
        },
      );
      expect(mockSessionRepository.delete).toHaveBeenCalledWith(
        'upstream-session-123',
      );
    });

    it('should do nothing when no finalized upstream session exists', async () => {
      mockSessionRepository.findByOidcModelId.mockResolvedValue(null);

      await service.logoutUpstreamSessionForOidcSession({
        oidcModelId: 'oidc-model-123',
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockSessionRepository.delete).not.toHaveBeenCalled();
    });

    it('should not delete the local session when upstream logout fails', async () => {
      (service as any).config = {
        issuer: 'http://localhost:8080',
      };

      mockSessionRepository.findByOidcModelId.mockResolvedValue({
        id: 'upstream-session-123',
        upstreamIdToken: 'stored-id-token',
      });

      const oidc = require('openid-client');
      oidc.buildEndSessionUrl.mockReturnValue(
        new URL('http://localhost:8080/logout?id_token_hint=stored-id-token'),
      );
      (global.fetch as jest.Mock).mockResolvedValue({ status: 500 });

      await expect(
        service.logoutUpstreamSessionForOidcSession({
          oidcModelId: 'oidc-model-123',
          oidcSessionUid: 'session-uid-123',
        }),
      ).rejects.toThrow('Upstream end-session request failed with status 500');

      expect(mockSessionRepository.delete).not.toHaveBeenCalled();
    });
  });
});
