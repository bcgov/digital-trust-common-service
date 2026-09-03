import {
  ConnectionProtocol,
  ConnectionState,
  ConnectorType,
} from '../connection/connection.entity';
import {
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from '../credential-definition/credential-definition.entity';
import {
  IssuanceProfileProtocolHint,
  IssuanceProfileStatus,
} from '../issuance-profile/issuance-profile.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { OperationState } from '../operation/operation.entity';
import { TenantStatus } from '../tenant/tenant.entity';
import {
  TenantUserRole,
  TenantUserStatus,
} from '../tenant-user/tenant-user.entity';
import {
  VerificationProfileProtocolHint,
  VerificationProfileStatus,
} from '../verification-profile/verification-profile.entity';

export const ADMIN_SCOPES = [
  'credentials:offer',
  'credentials:verify',
  'connections:manage',
  'profiles:manage',
  'users:manage',
  'clients:manage',
  'logs:read',
] as const;

export const MEMBER_SCOPES = [
  'credentials:offer',
  'credentials:verify',
] as const;

export const MOCK_TRACTION_ENDPOINT = 'https://sandbox.traction.example.test';

export interface SeedTenantDefinition {
  slug: string;
  name: string;
  status: TenantStatus;
  description: string;
  seedDemoData: boolean;
}

export interface SeedUserDefinition {
  /**
   * Keycloak subject. `null` seeds an unclaimed invitation: the row carries
   * no identity until someone signs in with a matching email and the login
   * callback claims it. A placeholder value can never match a real account,
   * so that user exists only to populate lists.
   */
  externalUserId: string | null;
  email: string;
  displayName: string;
  role: TenantUserRole;
  status: TenantUserStatus;
}

export interface SeedConnectionDefinition {
  externalConnectionId: string;
  theirLabel: string;
  theirDid: string;
  state: ConnectionState;
}

export interface SeedOperationDefinition {
  externalId: string;
  type: string;
  state: OperationState;
  result?: Record<string, unknown> | { code: string; message: string } | null;
}

export const SEED_TENANTS: readonly SeedTenantDefinition[] = [
  {
    slug: 'acme-corp',
    name: 'Acme Corp',
    status: TenantStatus.ACTIVE,
    description: 'Primary demo tenant for local development.',
    seedDemoData: true,
  },
  {
    slug: 'test-org',
    name: 'Test Org',
    status: TenantStatus.ACTIVE,
    description: 'Secondary active tenant for multi-tenant UI testing.',
    seedDemoData: true,
  },
  {
    slug: 'suspended-co',
    name: 'Suspended Co',
    status: TenantStatus.SUSPENDED,
    description: 'Suspended tenant for status-filter UI testing.',
    seedDemoData: false,
  },
];

export function seedApiClientId(slug: string): string {
  return `dev-seed-${slug}-api`;
}

/**
 * The admin UI's OIDC client. Public rather than confidential:
 * a browser app cannot keep a secret, so it authenticates with PKCE alone.
 *
 * The SPA reads the id it presents from its runtime config (`oidcClientId`
 * in `config.json`), which defaults to this value; an environment that
 * registers its client under another id sets it there.
 */
export const UI_SPA_CLIENT_ID = 'dtsc-ui';

/**
 * Interactive login is tenant-scoped through the client: the OIDC
 * interaction controller reads `client.tenantId` to pick the upstream
 * federation and to resolve the `tenant_user` row on callback. So the SPA
 * client belongs to one tenant, and a dev login always lands in this one.
 */
export const UI_SPA_TENANT_SLUG = 'acme-corp';

/**
 * Subject for a seeded user that is not meant to sign in. Also how the seed
 * recognises a row it created before it seeded invitations.
 */
export function seedPlaceholderExternalUserId(
  slug: string,
  role: TenantUserRole,
): string {
  return `dev-${slug}-${role}`;
}

/**
 * The SPA client's tenant gets invitations at emails the checked-in Keycloak
 * realm (keycloak/config/realm.json) has accounts for, so each role can be
 * exercised through a real sign-in. Every other tenant's users are
 * placeholders: they populate member lists and cannot sign in.
 */
export function seedUsersForTenant(slug: string): SeedUserDefinition[] {
  const invitable = slug === UI_SPA_TENANT_SLUG;
  const roles: ReadonlyArray<[TenantUserRole, string]> = [
    [TenantUserRole.OWNER, 'Owner'],
    [TenantUserRole.ADMIN, 'Admin'],
    [TenantUserRole.MEMBER, 'Member'],
  ];

  return roles.map(([role, label]) => ({
    externalUserId: invitable
      ? null
      : seedPlaceholderExternalUserId(slug, role),
    email: `${role}@${slug}.example.test`,
    displayName: `${slug} ${label}`,
    role,
    status: invitable ? TenantUserStatus.INVITED : TenantUserStatus.ACTIVE,
  }));
}

/**
 * Paths on the SPA the provider redirects back to, after authorization and
 * after an RP-initiated logout. Spelled here and in the SPA
 * (apps/ui/src/lib/auth/constants.ts); the provider's exact-match check is
 * the only thing that notices when the two drift.
 */
export const UI_SPA_CALLBACK_PATH = '/auth/callback';
export const UI_SPA_POST_LOGOUT_PATH = '/login';

/**
 * The SPA's origin, derived from the provider's issuer. The front door
 * serves the SPA and mounts the provider under `/oidc` on one origin — Caddy
 * locally, the frontend Deployment in Kubernetes — so the issuer's origin is
 * the SPA's origin wherever the seed runs: `https://app.localhost` locally,
 * the PR route in a PR environment. Deriving it is what makes the registered
 * redirect URIs right in every environment rather than in one.
 */
export function uiSpaOrigin(issuer: string): string {
  return new URL(issuer).origin;
}

export function uiSpaRedirectUris(origin: string): string[] {
  return [`${origin}${UI_SPA_CALLBACK_PATH}`];
}

export function uiSpaPostLogoutRedirectUris(origin: string): string[] {
  return [`${origin}${UI_SPA_POST_LOGOUT_PATH}`];
}

/**
 * Only the claim-releasing scopes every role holds. `readonly` ships with no
 * API scopes at all, and the interaction controller rejects (rather than
 * trims) a request for scopes the user's role lacks — so asking for e.g.
 * `tenants:admin` here would break sign-in for lower-privileged users.
 */
export const UI_SPA_SCOPES = [
  'openid',
  'profile',
  'email',
  'tenant',
  'offline_access',
] as const;

export const SEED_CREDENTIAL_DEFINITIONS = [
  {
    name: 'Person credential',
    format: CredentialDefinitionFormat.ANONCREDS,
    externalId: 'seed-person-cred-def',
    connectorType: CredentialDefinitionConnectorType.TRACTION,
    schemaDefinition: {
      attributes: [
        'given_names',
        'family_name',
        'birthdate_dateint',
        'postal_code',
        'picture',
      ],
      version: '1.0',
    },
    metadata: { seed: true, label: 'Person credential' },
  },
  {
    name: 'Employee badge',
    format: CredentialDefinitionFormat.ANONCREDS,
    externalId: 'seed-employee-badge-cred-def',
    connectorType: CredentialDefinitionConnectorType.TRACTION,
    schemaDefinition: {
      attributes: ['employee_id', 'department', 'title', 'issued_date'],
      version: '1.0',
    },
    metadata: { seed: true, label: 'Employee badge' },
  },
] as const;

export const SEED_ISSUANCE_PROFILES = [
  {
    name: 'person-credential',
    version: '1.0',
    description: 'Published person credential issuance profile.',
    status: IssuanceProfileStatus.PUBLISHED,
    credentialDefinitionName: 'Person credential',
    attributeSchema: {
      attributes: ['given_names', 'family_name', 'birthdate_dateint'],
    },
    protocolHint: IssuanceProfileProtocolHint.DIDCOMM,
  },
  {
    name: 'employee-badge',
    version: '1.0',
    description: 'Draft employee badge issuance profile.',
    status: IssuanceProfileStatus.DRAFT,
    credentialDefinitionName: 'Employee badge',
    attributeSchema: {
      attributes: ['employee_id', 'department', 'title'],
    },
    protocolHint: IssuanceProfileProtocolHint.DIDCOMM,
  },
] as const;

export const SEED_VERIFICATION_PROFILE = {
  name: 'identity-check',
  version: '1.0',
  description: 'Published age verification profile with birthdate predicate.',
  status: VerificationProfileStatus.PUBLISHED,
  issuanceProfileName: 'person-credential',
  issuanceProfileVersion: '1.0',
  requestedAttributes: ['given_names', 'family_name'],
  predicates: [
    {
      name: 'age_verification',
      p_type: '>=',
      p_value: 19,
      attribute_name: 'birthdate_dateint',
    },
  ],
  presentationDefinition: {
    id: 'identity-check-v1',
    input_descriptors: [
      {
        id: 'person_credential',
        name: 'Person credential',
        constraints: {
          fields: [
            {
              path: ['$.credentialSubject.given_names'],
              purpose: 'Verify given names',
            },
            {
              path: ['$.credentialSubject.birthdate_dateint'],
              purpose: 'Age verification',
              filter: { type: 'number', minimum: 19 },
            },
          ],
        },
      },
    ],
  },
  protocolHint: VerificationProfileProtocolHint.DIDCOMM,
  isPublic: false,
} as const;

export const SEED_CONNECTIONS: readonly SeedConnectionDefinition[] = [
  {
    externalConnectionId: 'seed-conn-invited',
    theirLabel: 'Alice (invited)',
    theirDid: 'did:example:alice-invited',
    state: ConnectionState.INVITED,
  },
  {
    externalConnectionId: 'seed-conn-requested',
    theirLabel: 'Bob (requested)',
    theirDid: 'did:example:bob-requested',
    state: ConnectionState.REQUESTED,
  },
  {
    externalConnectionId: 'seed-conn-active',
    theirLabel: 'Carol (active)',
    theirDid: 'did:example:carol-active',
    state: ConnectionState.ACTIVE,
  },
  {
    externalConnectionId: 'seed-conn-completed',
    theirLabel: 'Dave (completed)',
    theirDid: 'did:example:dave-completed',
    state: ConnectionState.COMPLETED,
  },
  {
    externalConnectionId: 'seed-conn-abandoned',
    theirLabel: 'Eve (abandoned)',
    theirDid: 'did:example:eve-abandoned',
    state: ConnectionState.ABANDONED,
  },
];

export const SEED_OPERATIONS: readonly SeedOperationDefinition[] = [
  {
    externalId: 'seed-op-pending',
    type: OPERATION_TYPE.CREDENTIAL_OFFER,
    state: OperationState.PENDING,
    result: null,
  },
  {
    externalId: 'seed-op-completed',
    type: OPERATION_TYPE.CREDENTIAL_OFFER,
    state: OperationState.COMPLETED,
    result: {
      credentialExchangeId: 'seed-exchange-completed',
      state: 'done',
    },
  },
  {
    externalId: 'seed-op-failed',
    type: 'presentation.verify',
    state: OperationState.FAILED,
    result: {
      code: 'VERIFICATION_FAILED',
      message: 'Proof request timed out (seed data).',
    },
  },
];

export const SEED_CONNECTOR = {
  connectorType: ConnectorType.TRACTION,
  protocol: ConnectionProtocol.DIDCOMM_V1,
  credentials: {
    apiKey: 'dev-seed-traction-api-key',
    tractionTenantId: 'dev-seed-traction-tenant',
  },
} as const;
