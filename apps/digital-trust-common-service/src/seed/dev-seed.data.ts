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
import { TenantUserRole } from '../tenant-user/tenant-user.entity';
import {
  VerificationProfileProtocolHint,
  VerificationProfileStatus,
} from '../verification-profile/verification-profile.entity';

export const DEV_SEED_CLIENT_SECRET = 'dev-seed-client-secret';

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
  externalUserId: string;
  email: string;
  displayName: string;
  role: TenantUserRole;
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

export function seedUsersForTenant(slug: string): SeedUserDefinition[] {
  return [
    {
      externalUserId: `dev-${slug}-owner`,
      email: `owner@${slug}.example.test`,
      displayName: `${slug} Owner`,
      role: TenantUserRole.OWNER,
    },
    {
      externalUserId: `dev-${slug}-admin`,
      email: `admin@${slug}.example.test`,
      displayName: `${slug} Admin`,
      role: TenantUserRole.ADMIN,
    },
    {
      externalUserId: `dev-${slug}-member`,
      email: `member@${slug}.example.test`,
      displayName: `${slug} Member`,
      role: TenantUserRole.MEMBER,
    },
  ];
}

export function seedApiClientId(slug: string): string {
  return `dev-seed-${slug}-api`;
}

/**
 * The admin UI's OIDC client. Public rather than confidential:
 * a browser app cannot keep a secret, so it authenticates with PKCE alone.
 *
 * The id is well-known rather than generated because the SPA is built once
 * and deployed everywhere — it reads the id from `VITE_OIDC_CLIENT_ID`,
 * which defaults to this value. Non-dev environments register their own
 * client with the same id.
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
 * The Caddy front door (see caddy/Caddyfile), not the raw Vite origin.
 * `OIDC_ISSUER` is `https://app.localhost/oidc`, and every endpoint in the
 * discovery document points there — reaching the SPA on
 * `http://localhost:5173` would put the authorize/token calls cross-origin
 * and drop the provider's session cookie.
 */
export const UI_SPA_REDIRECT_URIS = ['https://app.localhost/auth/callback'];

export const UI_SPA_POST_LOGOUT_REDIRECT_URIS = ['https://app.localhost/login'];

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
  credentialsPlainText: JSON.stringify({
    apiKey: 'dev-seed-traction-api-key',
    tenantId: 'dev-seed-traction-tenant',
  }),
} as const;
