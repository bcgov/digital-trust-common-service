export type OidcTenantUserRole = 'owner' | 'admin' | 'member' | 'readonly';
export type OidcTenantUserStatus = 'active' | 'invited' | 'disabled';

export interface OidcTenantUserRecord {
  id: string;
  tenantId: string;
  /**
   * Absent until an invited user completes their first login and gets
   * linked to a real external (Keycloak) identity.
   */
  externalUserId?: string;
  email: string;
  displayName?: string;
  role: OidcTenantUserRole;
  status: OidcTenantUserStatus;
}

export interface OidcCreateTenantUserInput {
  tenantId: string;
  externalUserId: string;
  email: string;
  displayName: string;
  role: OidcTenantUserRole;
  status: OidcTenantUserStatus;
}

export interface OidcTenantUserPort {
  findById(id: string): Promise<OidcTenantUserRecord | undefined>;
  findByTenantAndExternalUserId(
    tenantId: string,
    externalUserId: string,
  ): Promise<OidcTenantUserRecord | null>;
  /**
   * Atomically claims a previously-invited tenant user (matched by
   * case-insensitive email, with no `externalUserId` yet) by linking it to
   * the given external identity and activating it, while preserving the
   * invited role. Returns `null` if no matching invited row exists.
   */
  claimInvitedByEmail(
    tenantId: string,
    email: string,
    externalUserId: string,
  ): Promise<OidcTenantUserRecord | null>;
  create(input: OidcCreateTenantUserInput): Promise<OidcTenantUserRecord>;
}

export const OIDC_TENANT_USER_PORT = Symbol('OIDC_TENANT_USER_PORT');
