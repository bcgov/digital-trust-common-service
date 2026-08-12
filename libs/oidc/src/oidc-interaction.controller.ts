import { IncomingMessage, ServerResponse } from 'http';
import { Http2ServerRequest, Http2ServerResponse } from 'http2';

import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OAuthClientService } from '../../../apps/digital-trust-common-service/src/oauth-client/oauth-client.service';
import {
  TenantUserRole,
  TenantUserStatus,
} from '../../../apps/digital-trust-common-service/src/tenant-user/tenant-user.entity';
import { TenantUserService } from '../../../apps/digital-trust-common-service/src/tenant-user/tenant-user.service';
import { UpstreamOidcService } from '../../../apps/digital-trust-common-service/src/upstream-oidc/oidc-upstream.service';

import { OidcProviderService } from './oidc-provider.service';

type OidcResponse =
  ServerResponse<IncomingMessage> | Http2ServerResponse<Http2ServerRequest>;

@Controller({ path: 'oidc/' })
export class OidcInteractionController {
  public constructor(
    private readonly providerService: OidcProviderService,
    private readonly upstreamOidcService: UpstreamOidcService,
    private readonly tenantUserService: TenantUserService,
    private readonly oauthClientService: OAuthClientService,
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

    const grant = new provider.Grant({
      clientId,
      accountId,
    });

    if (prompt.details.missingOIDCScope) {
      grant.addOIDCScope(
        (prompt.details.missingOIDCScope as string[]).join(' '),
      );
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

    const client = await this.oauthClientService.findByClientId(clientId);

    if (!client) {
      throw new Error(`OAuth client not found: ${clientId}`);
    }

    const { authorizationUrl } =
      await this.upstreamOidcService.initiateUpstreamLogin(
        details.uid,
        client.tenantId,
        `${this.configService.get<string>('OIDC_ISSUER', 'http://localhost:3000/oidc')}/callback`,
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
        `Upstream OIDC error: ${this.escapeHtml(error)}\n${this.escapeHtml(errorDescription ?? '')}`,
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
      const { claims, interaction } =
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

      if (!federatedUser) {
        federatedUser = await this.tenantUserService.create({
          tenantId,
          externalUserId: claims.sub,
          email: claims.email ?? '',
          displayName: claims.name ?? claims.email ?? claims.sub,
          role: TenantUserRole.READONLY,
          status: TenantUserStatus.ACTIVE,
        });
      }

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
      const interactionUrl = `${this.configService.get<string>('OIDC_ISSUER', 'http://localhost:3000/oidc')}/interaction/${interaction.interactionUid}`;

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
        `Error processing callback: ${this.escapeHtml(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
    }
  }

  /**
   * Escape HTML special characters to prevent XSS.
   */
  private escapeHtml(text: string): string {
    const htmlEscapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] ?? char);
  }
}
