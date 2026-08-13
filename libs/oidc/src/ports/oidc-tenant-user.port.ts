export type OidcTenantUserRole = 'owner' | 'admin' | 'member' | 'readonly';
export type OidcTenantUserStatus = 'active' | 'invited' | 'disabled';

export interface OidcTenantUserRecord {
  id: string;
  tenantId: string;
  externalUserId: string;
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
  create(input: OidcCreateTenantUserInput): Promise<OidcTenantUserRecord>;
}

export const OIDC_TENANT_USER_PORT = Symbol('OIDC_TENANT_USER_PORT');
