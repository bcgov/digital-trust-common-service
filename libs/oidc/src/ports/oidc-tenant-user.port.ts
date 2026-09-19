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
   * Active memberships for a Keycloak subject, oldest first (`created_at ASC`).
   * Memberships whose tenant is soft-deleted are excluded. Used at login to
   * pick the first tenant when a user belongs to more than one; non-active
   * tenants (suspended, deactivated) are still returned so callers can list
   * them with their status.
   */
  findActiveByExternalUserId(
    externalUserId: string,
  ): Promise<OidcTenantUserRecord[]>;
  /**
   * Claims every unclaimed invitation at this email (matched case-insensitively,
   * `externalUserId` still null), in any tenant, linking each to the given
   * external identity and activating it with the role it was invited at.
   * Returns the rows it changed, in no meaningful order; empty when there was
   * nothing to claim. Invitations in soft-deleted tenants, and in tenants where
   * this identity already has a row, are left alone. The rows carry no `tenant`
   * relation.
   */
  claimAllInvitedByEmail(
    email: string,
    externalUserId: string,
  ): Promise<OidcTenantUserRecord[]>;
  create(input: OidcCreateTenantUserInput): Promise<OidcTenantUserRecord>;
}

export const OIDC_TENANT_USER_PORT = Symbol('OIDC_TENANT_USER_PORT');
