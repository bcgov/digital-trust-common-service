import { TenantAccessDeniedException, type AuthContext } from '@app/auth';
import { OidcConfigService, OidcProviderService } from '@app/oidc';
import { OidcAccountSessionRepository } from '@app/oidc/sessions';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { RoleScopeRepository } from '../role-scope/role-scope.repository';
import {
  TenantUser,
  TenantUserStatus,
} from '../tenant-user/tenant-user.entity';
import { TenantUserService } from '../tenant-user/tenant-user.service';

import { AuthTenantDto } from './dto/auth-tenant.dto';
import { SwitchTenantResponseDto } from './dto/switch-tenant-response.dto';

const STANDARD_OIDC_SCOPES = [
  'openid',
  'profile',
  'email',
  'tenant',
  'offline_access',
];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  public constructor(
    private readonly tenantUsers: TenantUserService,
    private readonly roleScopes: RoleScopeRepository,
    private readonly oidcProvider: OidcProviderService,
    private readonly oidcConfig: OidcConfigService,
    private readonly accountSessions: OidcAccountSessionRepository,
    private readonly domainAudit: DomainAuditService,
  ) {}

  public async listTenants(auth: AuthContext): Promise<AuthTenantDto[]> {
    this.assertUserToken(auth);

    const current = await this.tenantUsers.findById(auth.sub);
    if (!current.externalUserId) {
      throw new ForbiddenException(
        'Token subject is not linked to an external identity',
      );
    }

    const memberships = await this.tenantUsers.findActiveByExternalUserId(
      current.externalUserId,
    );

    return memberships.flatMap((membership) => {
      if (!membership.tenant) {
        return [];
      }

      return [
        {
          id: membership.tenant.id,
          name: membership.tenant.name,
          slug: membership.tenant.slug,
          role: membership.role,
        },
      ];
    });
  }

  public async switchTenant(
    auth: AuthContext,
    targetTenantId: string,
  ): Promise<SwitchTenantResponseDto> {
    this.assertUserToken(auth);

    if (!auth.clientId) {
      throw new ForbiddenException(
        'Token is missing client_id; cannot switch tenant',
      );
    }

    const current = await this.tenantUsers.findById(auth.sub);
    if (!current.externalUserId) {
      throw new ForbiddenException(
        'Token subject is not linked to an external identity',
      );
    }

    const target = await this.tenantUsers.findByTenantAndExternalUserId(
      targetTenantId,
      current.externalUserId,
    );

    if (!target || target.status !== TenantUserStatus.ACTIVE) {
      throw new TenantAccessDeniedException(
        'User is not an active member of the target tenant',
        {
          requiredTenantId: targetTenantId,
          tokenTenantId: current.tenantId,
        },
      );
    }

    // oidc-provider adapters key AccessToken by model id (`jti`), not the
    // raw JWT string returned to clients.
    const provider = this.oidcProvider.getProvider();
    const existingAccessToken = auth.jti
      ? await provider.AccessToken.find(auth.jti)
      : undefined;
    const previousGrantId = existingAccessToken?.grantId;

    const issued = await this.issueTokensForMembership(auth.clientId, target);

    if (previousGrantId && previousGrantId !== issued.grantId) {
      await this.revokeGrant(previousGrantId);
    }

    await this.accountSessions.rebindSessionsToAccount(
      current.id,
      target.id,
      auth.clientId,
      issued.grantId,
    );

    if (current.id !== target.id) {
      await this.accountSessions.deleteAllForAccount(current.id);
    }

    await this.domainAudit.emit({
      tenantId: target.tenantId,
      action: AuditAction.TOKEN_GRANT,
      resourceType: 'oidc_grant',
      resourceId: issued.grantId,
      metadata: {
        from_tenant_id: current.tenantId,
        to_tenant_id: target.tenantId,
      },
    });

    this.logger.log(
      `Switched tenant context for ${current.externalUserId} from ${current.tenantId} to ${target.tenantId}`,
    );

    return {
      access_token: issued.accessToken,
      refresh_token: issued.refreshToken,
      token_type: 'Bearer',
      expires_in: this.oidcConfig.getConfig().accessTokenTtlSeconds,
    };
  }

  private assertUserToken(auth: AuthContext): void {
    if (auth.tokenType !== 'user') {
      throw new ForbiddenException(
        'Machine clients cannot switch tenants; each client_id is bound to one tenant',
      );
    }
  }

  private async issueTokensForMembership(
    clientId: string,
    membership: TenantUser,
  ): Promise<{ accessToken: string; refreshToken: string; grantId: string }> {
    const provider = this.oidcProvider.getProvider();
    const { audience } = this.oidcConfig.getConfig();
    const client = await provider.Client.find(clientId);

    if (!client) {
      throw new ForbiddenException(`OAuth client not found: ${clientId}`);
    }

    // Pass tenantId so tenant_role_scope overrides apply on switch.
    const roleScopes = await this.roleScopes.findScopesForRole(
      membership.role,
      membership.tenantId,
    );
    const resourceScope = roleScopes.join(' ');
    const oidcScope = [...STANDARD_OIDC_SCOPES, ...roleScopes].join(' ');

    const grant = new provider.Grant({
      clientId,
      accountId: membership.id,
    });
    grant.addOIDCScope(oidcScope);

    if (resourceScope.length > 0) {
      grant.addResourceScope(audience, resourceScope);
    }

    const grantId = await grant.save();

    const accessTokenModel = new provider.AccessToken({
      accountId: membership.id,
      client,
      grantId,
      gty: 'authorization_code',
      scope: resourceScope.length > 0 ? resourceScope : oidcScope,
      expiresWithSession: false,
      resource: audience,
      resourceServer: {
        audience,
        accessTokenFormat: 'jwt',
        jwt: { sign: { alg: 'RS256' } },
        scope: resourceScope.length > 0 ? resourceScope : oidcScope,
      },
    });
    const accessToken = await accessTokenModel.save();

    const refreshTokenModel = new provider.RefreshToken({
      client,
      accountId: membership.id,
      grantId,
      gty: 'authorization_code',
      scope: oidcScope,
      expiresWithSession: false,
      rotations: 0,
      resource: audience,
    });
    const refreshToken = await refreshTokenModel.save();

    return { accessToken, refreshToken, grantId };
  }

  private async revokeGrant(grantId: string): Promise<void> {
    const provider = this.oidcProvider.getProvider();
    const grant = await provider.Grant.find(grantId);

    await grant?.destroy();
    await provider.AccessToken.revokeByGrantId(grantId);
    await provider.RefreshToken.revokeByGrantId(grantId);
  }
}
