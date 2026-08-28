import { randomBytes } from 'crypto';

import { PLATFORM_ADMIN_ROLE, TENANT_SUPERUSER_SCOPE } from '@app/auth';
import { OidcConfigService } from '@app/oidc';
import { Injectable } from '@nestjs/common';
import { argon2i, hash } from 'argon2';

import { OAuthClient } from '../oauth-client/oauth-client.entity';
import { OAuthClientRepository } from '../oauth-client/oauth-client.repository';
import { TenantStatus } from '../tenant/tenant.entity';
import { TenantRepository } from '../tenant/tenant.repository';

/** What the SPA presents (its runtime config defaults to this). */
export const UI_CLIENT_ID = 'dtsc-ui';
export const ADMIN_CLIENT_ID = 'dtsc-platform-admin';
// As in apps/ui/src/lib/auth/constants.ts; the provider matches exactly.
const UI_CALLBACK_PATH = '/auth/callback';
const UI_POST_LOGOUT_PATH = '/login';
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
  ): Promise<BootstrapResult> {
    const tenant =
      (await this.tenants.findBySlug(slug)) ??
      (await this.tenants.update(
        this.tenants.create({ slug, name, status: TenantStatus.ACTIVE }),
      ));

    // The front door serves the SPA and /oidc on one origin.
    const origin = new URL(this.oidcConfig.getConfig().issuer).origin;
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

    return { tenantId: tenant.id, redirectUris, adminClientSecret };
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
