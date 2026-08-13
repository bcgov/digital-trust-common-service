import { existsSync, readFileSync } from 'fs';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import * as oidc from 'openid-client';

import { OidcUpstreamInteraction } from './oidc-upstream-interaction.entity';
import { OidcUpstreamInteractionRepository } from './oidc-upstream-interaction.repository';

interface UpstreamOidcConfig {
  url: string;
  clientId: string;
  clientSecret: string;
}

@Injectable()
export class UpstreamOidcService implements OnModuleInit {
  private readonly logger = new Logger(UpstreamOidcService.name);

  public constructor(
    private readonly configService: ConfigService,
    private readonly interactionRepository: OidcUpstreamInteractionRepository,
  ) {}

  private config!: oidc.Configuration;

  public async onModuleInit() {
    const oidcConfigPath = this.configService.get<string>(
      'UPSTREAM_IDENTITY_FEDERATION_CONFIG_PATH',
    );

    if (!oidcConfigPath) {
      throw new Error(
        'UPSTREAM_IDENTITY_FEDERATION_CONFIG_PATH environment variable is not set.',
      );
    }

    if (!existsSync(oidcConfigPath)) {
      throw new Error(
        `Upstream OIDC config file does not exist: ${oidcConfigPath}`,
      );
    }

    let upstreamOidcConfig: UpstreamOidcConfig;

    try {
      const contents = readFileSync(oidcConfigPath, 'utf8');

      upstreamOidcConfig = JSON.parse(contents) as UpstreamOidcConfig;
    } catch (error) {
      throw new Error(
        `Unable to load upstream OIDC configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    this.config = await oidc.discovery(
      new URL(upstreamOidcConfig.url),
      upstreamOidcConfig.clientId,
      {
        client_secret: upstreamOidcConfig.clientSecret,
      },
    );
  }

  public getConfig(): oidc.Configuration {
    if (!this.config) {
      throw new Error('OIDC config not initialized.');
    }
    return this.config;
  }

  /**
   * Store an upstream OIDC interaction with state and code verifier.
   * TTL defaults to 15 minutes.
   */
  public async storeInteraction(
    state: string,
    nonce: string,
    codeVerifier: string,
    interactionUid: string,
    tenantId: string,
    tenantUserId?: string,
    ttlMinutes: number = 15,
  ): Promise<OidcUpstreamInteraction> {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const interaction = await this.interactionRepository.upsertByInteractionUid(
      {
        state,
        nonce,
        interactionUid,
        codeVerifier,
        tenantId,
        tenantUserId,
        expiresAt,
      },
    );

    this.logger.debug(
      `Stored upstream OIDC interaction with state: ${state.substring(0, 8)}...`,
    );

    return interaction;
  }

  /**
   * Retrieve an interaction by state and validate it hasn't expired.
   */
  public async validateInteraction(
    state: string,
  ): Promise<OidcUpstreamInteraction> {
    const interaction = await this.interactionRepository.findByState(state);

    if (!interaction) {
      throw new Error(`Interaction not found for state: ${state}`);
    }

    // Check if expired
    if (interaction.expiresAt < new Date()) {
      throw new Error(`Interaction has expired for state: ${state}`);
    }

    return interaction;
  }

  /**
   * Mark an interaction as consumed.
   */
  public async consumeInteraction(
    state: string,
  ): Promise<OidcUpstreamInteraction> {
    const interaction = await this.validateInteraction(state);

    interaction.consumedAt = new Date();
    const updated = await this.interactionRepository.update(interaction);

    this.logger.debug(
      `Consumed upstream OIDC interaction with state: ${state.substring(0, 10)}...`,
    );

    return updated;
  }

  /**
   * Get an interaction by state without validation.
   */
  public async getInteractionByState(
    state: string,
  ): Promise<OidcUpstreamInteraction | null> {
    return await this.interactionRepository.findByState(state);
  }

  public async getInteractionByUid(
    id: string,
  ): Promise<OidcUpstreamInteraction | null> {
    return await this.interactionRepository.findByInteractionUid(id);
  }

  public async setTenantUserIdForInteraction(
    state: string,
    tenantUserId: string,
  ): Promise<OidcUpstreamInteraction> {
    const interaction = await this.validateInteraction(state);

    interaction.tenantUserId = tenantUserId;
    const updated = await this.interactionRepository.update(interaction);

    this.logger.debug(
      `Set tenantUserId for upstream OIDC interaction with state: ${state.substring(0, 10)}...`,
    );

    return updated;
  }

  /**
   * Clean up expired interactions.
   */
  public async cleanupExpiredInteractions(): Promise<number> {
    const expired = await this.interactionRepository.findExpiredInteractions();

    if (expired.length === 0) {
      return 0;
    }

    let deletedCount = 0;
    for (const interaction of expired) {
      await this.interactionRepository.delete(interaction.id);
      deletedCount++;
    }

    this.logger.debug(`Cleaned up ${deletedCount} expired OIDC interactions`);

    return deletedCount;
  }

  /**
   * Initiate the upstream login flow.
   * Generates PKCE, state, stores interaction, and returns the authorization URL.
   */
  public async initiateUpstreamLogin(
    interactionUid: string,
    tenantId: string,
    redirectUri: string,
  ): Promise<{ state: string; authorizationUrl: URL }> {
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const state = randomState();
    const nonce = randomNonce();

    await this.storeInteraction(
      state,
      nonce,
      codeVerifier,
      interactionUid,
      tenantId,
    );

    const config = this.getConfig();

    const authorizationUrl = buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { state, authorizationUrl };
  }

  /**
   * Handle the upstream callback.
   * Exchanges the authorization code and returns the claims and interaction.
   */
  public async handleUpstreamCallback(
    state: string,
    code: string,
    currentUrl: URL,
  ): Promise<{
    claims: {
      sub: string;
      email?: string;
      name?: string;
    };
    interaction: OidcUpstreamInteraction;
  }> {
    const interaction = await this.validateInteraction(state);

    const config = this.getConfig();

    const tokens = await authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: interaction.codeVerifier,
      expectedState: interaction.state,
      expectedNonce: interaction.nonce,
      idTokenExpected: true,
    });

    const claims = tokens.claims();

    if (
      typeof claims !== 'object' ||
      claims === null ||
      typeof (claims as Record<string, unknown>).sub !== 'string'
    ) {
      throw new Error('Invalid or missing sub claim in ID token');
    }

    return {
      claims: {
        sub: (claims as Record<string, unknown>).sub as string,
        email: (claims as Record<string, unknown>).email as string | undefined,
        name: (claims as Record<string, unknown>).name as string | undefined,
      },
      interaction,
    };
  }
}
