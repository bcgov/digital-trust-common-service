import { IncomingMessage, ServerResponse } from 'http';
import { Http2ServerRequest, Http2ServerResponse } from 'http2';

import { partitionRequestedScopes } from '@app/auth/utils/partition-requested-scopes';
import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import escapeHtml from 'escape-html';

import { buildOidcIssuerUrl } from './oidc-issuer-url.util';
import { OidcProviderService } from './oidc-provider.service';
import * as oidcClientLookupPort from './ports/oidc-client-lookup.port';
import * as oidcTenantUserPort from './ports/oidc-tenant-user.port';
import * as oidcUpstreamFederationPort from './ports/oidc-upstream-federation.port';

type OidcResponse =
  ServerResponse<IncomingMessage> | Http2ServerResponse<Http2ServerRequest>;
type RoleScopeLookup = {
  findScopesForRole(
    role: oidcTenantUserPort.OidcTenantUserRole,
    tenantId?: string,
  ): Promise<string[]>;
};

class UnauthorizedOidcScopeRequestError extends Error {
  public constructor(
    public readonly role: oidcTenantUserPort.OidcTenantUserRole,
    public readonly deniedScopes: readonly string[],
  ) {
    super(
      `Requested scopes exceed tenant-user role "${role}": ${deniedScopes.join(', ')}`,
    );
  }
}

@Controller({ path: 'oidc/' })
export class OidcInteractionController {
  private static readonly ACTIVE_TENANT_USER_STATUS = 'active';
  private static readonly DEFAULT_TENANT_USER_ROLE = 'readonly';
  private static readonly STANDARD_OIDC_SCOPES = new Set([
    'openid',
    'profile',
    'email',
    'tenant',
    'offline_access',
  ]);

  public constructor(
    private readonly providerService: OidcProviderService,
    @Inject(oidcUpstreamFederationPort.OIDC_UPSTREAM_FEDERATION_PORT)
    private readonly upstreamOidcService: oidcUpstreamFederationPort.OidcUpstreamFederationPort,
    @Inject(oidcTenantUserPort.OIDC_TENANT_USER_PORT)
    private readonly tenantUserService: oidcTenantUserPort.OidcTenantUserPort,
    @Inject('OIDC_ROLE_SCOPE_PORT')
    private readonly roleScopeService: RoleScopeLookup,
    @Inject(oidcClientLookupPort.OIDC_CLIENT_LOOKUP_PORT)
    private readonly clientLookup: oidcClientLookupPort.OidcClientLookupPort,
    private readonly configService: ConfigService,
  ) {}

  @Get('/interaction/:uid')
  public async interaction(
    @Req() req: IncomingMessage | Http2ServerRequest,
    @Res() res: OidcResponse,
  ): Promise<void> {
    const provider = this.providerService.getProvider();

    /*
     * This is the source of truth for what oidc-provider wants us
     * to do with this interaction.
     */
    const details = await provider.interactionDetails(req, res);

    /*
     * ------------------------------------------------------------
     * LOGIN
     * ------------------------------------------------------------
     *
     * There is no authenticated oidc-provider session.
     * Federate authentication to Keycloak.
     */
    if (details.prompt.name === 'login') {
      const interaction = await this.upstreamOidcService.getInteractionByUid(
        details.uid,
      );

      if (interaction?.consumedAt) {
        const { params, prompt } = details;

        try {
          const grantId = await this.createAndSaveGrant(
            params.client_id as string,
            interaction.tenantUserId as string,
            prompt,
          );

          await provider.interactionFinished(
            req,
            res,
            {
              login: {
                accountId: interaction.tenantUserId as string,
              },
              consent: {
                grantId,
              },
            },
            { mergeWithLastSubmission: false },
          );
        } catch (error) {
          if (this.tryWriteScopeDeniedResponse(res, error)) {
            return;
          }

          throw error;
        }

        return;
      }

      await this.startUpstreamLogin(req, res, details);

      return;
    }

    /*
     * ------------------------------------------------------------
     * CONSENT
     * ------------------------------------------------------------
     *
     * The user is ALREADY authenticated.
     *
     * In particular, if:
     *
     *   details.session.accountId
     *
     * exists, do NOT send the user back to Keycloak.
     *
     * We need to satisfy oidc-provider's consent interaction.
     */
    if (details.prompt.name === 'consent') {
      const { session, params, prompt } = details;

      if (!session?.accountId) {
        throw new Error('No authenticated session');
      }

      try {
        const grantId = await this.createAndSaveGrant(
          params.client_id as string,
          session.accountId,
          prompt,
        );

        /*
         * For now, approve everything that oidc-provider is asking
         * for.
         *
         * interactionFinished() owns the HTTP response. DO NOT call
         * res.end(), res.redirect(), or set Location afterwards.
         */
        await provider.interactionFinished(
          req,
          res,
          {
            consent: {
              grantId,
            },
          },
          {
            mergeWithLastSubmission: false,
          },
        );
      } catch (error) {
        if (this.tryWriteScopeDeniedResponse(res, error)) {
          return;
        }

        throw error;
      }

      return;
    }

    /*
     * We should not silently send an unknown prompt through the
     * federation flow.
     */
    throw new Error(
      `Unsupported oidc-provider interaction prompt: ${details.prompt.name}`,
    );
  }

  /**
   * Create and save a grant for the given client, account, and prompt details.
   */
  private async createAndSaveGrant(
    clientId: string,
    accountId: string,
    prompt: Awaited<
      ReturnType<
        ReturnType<OidcProviderService['getProvider']>['interactionDetails']
      >
    >['prompt'],
  ): Promise<string> {
    const provider = this.providerService.getProvider();
    const user = await this.tenantUserService.findById(accountId);

    if (!user || user.status !== 'active') {
      throw new Error(`Active tenant user not found: ${accountId}`);
    }

    // Tenant-scoped so a tenant's role override reaches the Grant, and
    // therefore the `scope` claim (AU-07 #40).
    const roleScopes = await this.roleScopeService.findScopesForRole(
      user.role,
      user.tenantId,
    );

    const grant = new provider.Grant({
      clientId,
      accountId,
    });

    if (prompt.details.missingOIDCScope) {
      const requestedScopes = prompt.details.missingOIDCScope as string[];
      const allowedScopes = [
        ...OidcInteractionController.STANDARD_OIDC_SCOPES,
        ...roleScopes,
      ];
      const { grantedScopes, deniedScopes } = partitionRequestedScopes({
        requestedScopes,
        allowedScopes,
        actorScopes: allowedScopes,
      });

      if (deniedScopes.length > 0) {
        throw new UnauthorizedOidcScopeRequestError(user.role, deniedScopes);
      }

      if (grantedScopes.length > 0) {
        grant.addOIDCScope(grantedScopes.join(' '));
      }
    }

    if (prompt.details.missingResourceScopes) {
      for (const [resource, scopes] of Object.entries(
        prompt.details.missingResourceScopes as Record<string, string[]>,
      )) {
        grant.addResourceScope(resource, scopes.join(' '));
      }
    }

    const grantId = await grant.save();
    return grantId;
  }

  private tryWriteScopeDeniedResponse(
    res: OidcResponse,
    error: unknown,
  ): boolean {
    if (!(error instanceof UnauthorizedOidcScopeRequestError)) {
      return false;
    }

    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    res.end(
      `Insufficient role for requested scopes: ${escapeHtml(error.message)}`,
    );

    return true;
  }

  /**
   * Start the upstream Keycloak authorization-code flow.
   */
  private async startUpstreamLogin(
    _req: IncomingMessage | Http2ServerRequest,
    res: OidcResponse,
    details: Awaited<
      ReturnType<
        ReturnType<OidcProviderService['getProvider']>['interactionDetails']
      >
    >,
  ): Promise<void> {
    /*
     * We should never start another upstream login if oidc-provider
     * already has an authenticated session.
     */
    if (details.session?.accountId) {
      throw new Error(
        `Attempted upstream login despite existing accountId ${details.session.accountId}`,
      );
    }

    const clientId = details.params.client_id;

    if (typeof clientId !== 'string') {
      throw new Error('Missing client_id in interaction params');
    }

    const client = await this.clientLookup.findActiveClient(clientId);

    if (!client) {
      throw new Error(`OAuth client not found: ${clientId}`);
    }

    const oidcIssuer = this.configService.get<string>(
      'OIDC_ISSUER',
      'http://localhost:3000/oidc',
    );

    const { authorizationUrl } =
      await this.upstreamOidcService.initiateUpstreamLogin(
        details.uid,
        client.tenantId,
        buildOidcIssuerUrl(oidcIssuer, 'callback'),
      );

    res.statusCode = 302;
    res.setHeader('Location', authorizationUrl.href);
    res.end();
  }

  @Get('/callback')
  public async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('nonce') nonce: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Req() req: IncomingMessage | Http2ServerRequest,
    @Res() res: OidcResponse,
  ): Promise<void> {
    if (error) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain');
      res.end(
        `Upstream OIDC error: ${escapeHtml(error)}\n${escapeHtml(errorDescription ?? '')}`,
      );
      return;
    }

    if (!code || !state) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Missing code or state in upstream callback');
      return;
    }

    try {
      /*
       * Reconstruct the EXACT callback URL received by this
       * application.
       */
      const forwardedProto = req.headers['x-forwarded-proto'];

      const proto =
        typeof forwardedProto === 'string'
          ? forwardedProto.split(',')[0].trim()
          : 'http';

      const host = req.headers.host;

      if (!host) {
        throw new Error('Missing Host header');
      }

      const currentUrl = new URL(req.url ?? '/', `${proto}://${host}`);

      /*
       * Handle the upstream OIDC callback, exchange code for tokens,
       * and extract claims.
       */
      const { claims, interaction, upstreamSession } =
        await this.upstreamOidcService.handleUpstreamCallback(
          state,
          code,
          currentUrl,
        );

      const tenantId = interaction.tenantId;

      /*
       * Find or create the local user.
       */
      let federatedUser =
        await this.tenantUserService.findByTenantAndExternalUserId(
          tenantId,
          claims.sub,
        );

      if (
        federatedUser &&
        federatedUser.status !==
          OidcInteractionController.ACTIVE_TENANT_USER_STATUS
      ) {
        throw new Error('Federated user is not active');
      }

      // A previously-invited user has no externalUserId yet, so the lookup
      // above misses; claim the invited row by email before falling back to
      // creating a brand-new one (which would otherwise collide with the
      // per-tenant email uniqueness constraint or create a duplicate).
      if (!federatedUser && claims.email) {
        federatedUser = await this.tenantUserService.claimInvitedByEmail(
          tenantId,
          claims.email,
          claims.sub,
        );
      }

      if (!federatedUser) {
        federatedUser = await this.tenantUserService.create({
          tenantId,
          externalUserId: claims.sub,
          email: claims.email ?? '',
          displayName: claims.name ?? claims.email ?? claims.sub,
          role: OidcInteractionController.DEFAULT_TENANT_USER_ROLE,
          status: OidcInteractionController.ACTIVE_TENANT_USER_STATUS,
        });
      }

      await this.upstreamOidcService.stagePendingUpstreamSession({
        tenantUserId: federatedUser.id,
        upstreamSubject: upstreamSession.upstreamSubject,
        upstreamIdToken: upstreamSession.upstreamIdToken,
        expiresAt: upstreamSession.expiresAt ?? null,
      });

      /*
       * Associate the federated user with this interaction.
       */
      await this.upstreamOidcService.setTenantUserIdForInteraction(
        state,
        federatedUser.id,
      );

      /*
       * Mark the upstream federation transaction consumed.
       */
      await this.upstreamOidcService.consumeInteraction(state);

      /*
       * Return to the SAME oidc-provider interaction.
       *
       * The interaction UID came from interactionDetails() when
       * we started the upstream flow.
       */
      const oidcIssuer = this.configService.get<string>(
        'OIDC_ISSUER',
        'http://localhost:3000/oidc',
      );
      const interactionUrl = buildOidcIssuerUrl(
        oidcIssuer,
        `interaction/${interaction.interactionUid}`,
      );

      res.statusCode = 302;
      res.setHeader('Location', interactionUrl);
      res.end();
    } catch (err) {
      if (res.headersSent) {
        return;
      }

      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain');
      res.end(
        `Error processing callback: ${escapeHtml(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
    }
  }
}
