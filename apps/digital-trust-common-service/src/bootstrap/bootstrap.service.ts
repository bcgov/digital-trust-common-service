import { randomBytes } from 'crypto';

import { PLATFORM_ADMIN_ROLE, TENANT_SUPERUSER_SCOPE } from '@app/auth';
import { OidcConfigService } from '@app/oidc';
import { Injectable } from '@nestjs/common';
import { argon2i, hash } from 'argon2';

import {
  ADMIN_CLIENT_ID,
  GRAFANA_CLIENT_ID,
  UI_CLIENT_ID,
} from '../oauth-client/oauth-client.constants';
import { OAuthClient } from '../oauth-client/oauth-client.entity';
import { OAuthClientRepository } from '../oauth-client/oauth-client.repository';
import { TenantStatus } from '../tenant/tenant.entity';
import { TenantRepository } from '../tenant/tenant.repository';

export {
  ADMIN_CLIENT_ID,
  GRAFANA_CLIENT_ID,
  UI_CLIENT_ID,
} from '../oauth-client/oauth-client.constants';

/** What the SPA presents (its runtime config defaults to this). */
// As in apps/ui/src/lib/auth/constants.ts; the provider matches exactly.
const UI_CALLBACK_PATH = '/auth/callback';
const UI_POST_LOGOUT_PATH = '/login';
// Grafana's generic_oauth callback; the provider matches it exactly.
const GRAFANA_CALLBACK_PATH = '/login/generic_oauth';
// Same parameters as OAuthClientService.
const ARGON2 = {
  type: argon2i,
  memoryCost: 16384,
  timeCost: 4,
  parallelism: 3,
} as const;

export interface BootstrapResult {
  tenantId: string;
  redirectUris: string[];
  /** Only when a Grafana URL was given. */
  grafanaRedirectUris?: string[];
  /** Only when this run minted one (first run, or rotation); stored as a hash. */
  adminClientSecret?: string;
}

/**
 * The minimum a hosted environment needs before everything else can be done
 * through the API: the operator's tenant, the SPA's public client on this
 * environment's origin, and one platform-admin machine client. Re-runnable.
 */
@Injectable()
export class EnvironmentBootstrapService {
  public constructor(
    private readonly tenants: TenantRepository,
    private readonly oauthClients: OAuthClientRepository,
    private readonly oidcConfig: OidcConfigService,
  ) {}

  public async run(
    slug: string,
    name: string,
    rotateAdminSecret = false,
    grafanaUrl?: string,
  ): Promise<BootstrapResult> {
    const tenant =
      (await this.tenants.findBySlug(slug)) ??
      (await this.tenants.update(
        this.tenants.create({ slug, name, status: TenantStatus.ACTIVE }),
      ));

    // The front door serves the SPA and /oidc on one origin.
    const origin = this.oidcConfig.getConfig().publicUrl;
    const redirectUris = [`${origin}${UI_CALLBACK_PATH}`];
    await this.upsertClient(UI_CLIENT_ID, {
      tenantId: tenant.id,
      name: 'Digital Trust Common Service UI',
      isPublic: true,
      clientSecretHash: null,
      scopes: ['openid', 'profile', 'email', 'tenant', 'offline_access'],
      grantTypes: ['authorization_code', 'refresh_token'],
      redirectUris,
      postLogoutRedirectUris: [`${origin}${UI_POST_LOGOUT_PATH}`],
    });

    // Grafana is served from its own host, so its redirect URI cannot come
    // from APP_PUBLIC_URL. It is registered only where Grafana is deployed.
    let grafanaRedirectUris: string[] | undefined;
    if (grafanaUrl) {
      grafanaRedirectUris = [
        `${new URL(grafanaUrl).origin}${GRAFANA_CALLBACK_PATH}`,
      ];
      await this.upsertClient(GRAFANA_CLIENT_ID, {
        tenantId: tenant.id,
        name: 'Tenant log viewer (Grafana)',
        isPublic: true,
        clientSecretHash: null,
        // Identity scopes only: Grafana puts every tenant in one org, so it
        // must not hold names or emails, and the provider refuses a request
        // for anything else. The gateway checks logs:read on every query.
        scopes: ['openid', 'tenant', 'offline_access'],
        grantTypes: ['authorization_code', 'refresh_token'],
        redirectUris: grafanaRedirectUris,
        postLogoutRedirectUris: [],
      });
    }

    let adminClientSecret: string | undefined;
    // Rotation is also the recovery path: once the only platform-admin secret
    // is lost, nothing can authenticate to rotate it through the API.
    if (
      rotateAdminSecret ||
      !(await this.oauthClients.findByClientId(ADMIN_CLIENT_ID))
    ) {
      adminClientSecret = randomBytes(32).toString('hex');
      await this.upsertClient(ADMIN_CLIENT_ID, {
        tenantId: tenant.id,
        name: 'Platform administration',
        clientSecretHash: await hash(adminClientSecret, ARGON2),
        scopes: [TENANT_SUPERUSER_SCOPE],
        roles: [PLATFORM_ADMIN_ROLE],
        grantTypes: ['client_credentials'],
        redirectUris: [],
      });
    }

    return {
      tenantId: tenant.id,
      redirectUris,
      grafanaRedirectUris,
      adminClientSecret,
    };
  }

  private async upsertClient(
    clientId: string,
    fields: Partial<OAuthClient>,
  ): Promise<void> {
    const client =
      (await this.oauthClients.findByClientId(clientId)) ?? new OAuthClient();
    await this.oauthClients.update(
      Object.assign(client, fields, { clientId, revokedAt: null }),
    );
  }
}
