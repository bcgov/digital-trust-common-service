import { http, HttpResponse } from 'msw';

import { API_BASE_PATH } from '@/lib/api/constants';
import type { Connection } from '@/lib/api/resources/connections';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';
import type { TenantUser } from '@/lib/api/resources/tenant-users';
import type { Tenant } from '@/lib/api/resources/tenants';
import { MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';

// Also bundled into the mock-mode browser build (browser.ts): keep vitest and
// node-only imports out of this file.

export const mockTenants: Tenant[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Ministry',
    slug: 'acme-ministry',
    description: 'First mock tenant',
    status: 'active',
    created_at: '2026-01-15T10:00:00.000Z',
    updated_at: '2026-01-15T10:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Example Agency',
    slug: 'example-agency',
    description: null,
    status: 'active',
    created_at: '2026-02-20T10:00:00.000Z',
    updated_at: '2026-02-20T10:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Suspended Society',
    slug: 'suspended-society',
    description: 'Suspended tenant for lifecycle testing',
    status: 'suspended',
    created_at: '2026-03-10T10:00:00.000Z',
    updated_at: '2026-03-10T10:00:00.000Z',
  },
];

// Two definitions and one connection, so a count can only match one fixture.
export const mockCredentialDefinitions: CredentialDefinition[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    name: 'Employee badge',
    format: 'anoncreds',
    connector_type: 'traction',
    is_active: true,
    created_at: '2026-04-01T10:00:00.000Z',
    updated_at: '2026-04-01T10:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    name: 'Visitor pass',
    format: 'anoncreds',
    connector_type: 'traction',
    is_active: true,
    created_at: '2026-04-02T10:00:00.000Z',
    updated_at: '2026-04-02T10:00:00.000Z',
  },
];

export const mockConnections: Connection[] = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    their_label: 'Alice',
    state: 'active',
    connector_type: 'traction',
    protocol: 'didcomm-v1',
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-05-01T10:00:00.000Z',
  },
];

// The first row's id is the mock auth client's `sub`, so the users page sees
// its own membership. The disabled row has no display name on purpose.
export const mockTenantUsers: TenantUser[] = [
  {
    id: 'mock-user',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    email: 'mock.user@example.com',
    display_name: 'Mock User',
    role: 'owner',
    status: 'active',
    created_at: '2026-01-15T10:00:00.000Z',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.com',
    display_name: 'Ada Admin',
    role: 'admin',
    status: 'active',
    created_at: '2026-02-01T10:00:00.000Z',
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    email: 'dormant@example.com',
    display_name: null,
    role: 'member',
    status: 'disabled',
    created_at: '2026-03-01T10:00:00.000Z',
  },
  {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    email: 'invited@example.com',
    display_name: null,
    role: 'member',
    status: 'invited',
    created_at: '2026-04-01T10:00:00.000Z',
  },
];

function encodeJwtSegment(value: Record<string, unknown>): string {
  const json = JSON.stringify(value);
  const base64 =
    typeof btoa === 'function'
      ? btoa(json)
      : Buffer.from(json, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** JWT-shaped (unsigned) mock AT so the OIDC client can decode its claims. */
export function mockAccessToken(claims: Record<string, unknown>): string {
  return [
    encodeJwtSegment({ alg: 'none', typ: 'JWT' }),
    encodeJwtSegment(claims),
    'sig',
  ].join('.');
}

/** What a switch mints: the admin role of the mock tenant and its scopes. */
export function mockSwitchedAccessToken(tenantId: string | undefined): string {
  return mockAccessToken({
    tenant_id: tenantId,
    roles: ['admin'],
    scope: 'openid profile email tenant offline_access users:manage',
  });
}

export const handlers = [
  // Bare array on purpose: mirrors the current (pre-envelope) implementation
  // so tests prove the client tolerates it.
  http.get(`${API_BASE_PATH}/tenants`, () => HttpResponse.json(mockTenants)),
  http.get(`${API_BASE_PATH}/tenants/:id`, ({ params }) => {
    const tenant = mockTenants.find((t) => t.id === params.id);
    return tenant
      ? HttpResponse.json(tenant)
      : new HttpResponse(null, { status: 404 });
  }),
  // Bare array: mirrors the implemented endpoint. Scoped by tenant like the
  // API, so another tenant's overview never shows Acme's figures.
  http.get(
    `${API_BASE_PATH}/tenants/:id/credential-definitions`,
    ({ params }) =>
      HttpResponse.json(
        mockCredentialDefinitions.filter((d) => d.tenant_id === params.id),
      ),
  ),
  // Envelope: mirrors the spec shape, so both list shapes stay exercised.
  http.get(`${API_BASE_PATH}/tenants/:id/connections`, ({ params }) =>
    HttpResponse.json({
      data: mockConnections.filter((c) => c.tenant_id === params.id),
      pagination: { next_cursor: null, has_more: false },
    }),
  ),
  // Envelope, scoped by tenant like the API. Mutations answer statically;
  // tests that need a body or a conflict override them.
  http.get(`${API_BASE_PATH}/tenants/:id/users`, ({ params }) =>
    HttpResponse.json({
      data: mockTenantUsers.filter((u) => u.tenant_id === params.id),
      pagination: { next_cursor: null, has_more: false },
    }),
  ),
  http.post(
    `${API_BASE_PATH}/tenants/:id/users`,
    async ({ params, request }) => {
      const body = (await request.json()) as Pick<TenantUser, 'email' | 'role'>;
      return HttpResponse.json(
        {
          id: crypto.randomUUID(),
          tenant_id: String(params.id),
          email: body.email,
          display_name: null,
          role: body.role,
          status: 'invited',
          created_at: new Date().toISOString(),
        } satisfies TenantUser,
        { status: 201 },
      );
    },
  ),
  http.patch(
    `${API_BASE_PATH}/tenants/:id/users/:userId`,
    async ({ params, request }) => {
      const existing = mockTenantUsers.find((u) => u.id === params.userId);
      if (!existing) return new HttpResponse(null, { status: 404 });
      const body = (await request.json()) as Partial<TenantUser>;
      return HttpResponse.json({ ...existing, ...body });
    },
  ),
  http.delete(
    `${API_BASE_PATH}/tenants/:id/users/:userId`,
    () => new HttpResponse(null, { status: 204 }),
  ),
  // Same fixture the mock auth client serves, so the two stay in lockstep.
  http.get(`${API_BASE_PATH}/auth/tenants`, () =>
    HttpResponse.json(MOCK_AUTH_TENANTS),
  ),
  http.post(`${API_BASE_PATH}/auth/switch-tenant`, async ({ request }) => {
    const body = (await request.json()) as { tenant_id?: string };
    const membership = MOCK_AUTH_TENANTS.find(
      (tenant) => tenant.id === body.tenant_id,
    );

    // Mirror the API: a known membership in a non-active tenant is refused.
    if (membership && membership.status !== 'active') {
      return HttpResponse.json(
        {
          error: {
            code: 'TENANT_NOT_ACTIVE',
            message: `Tenant is ${membership.status} and cannot perform this action`,
            tenant_status: membership.status,
          },
        },
        { status: 403 },
      );
    }

    return HttpResponse.json({
      access_token: mockSwitchedAccessToken(body.tenant_id),
      refresh_token: 'mock-refresh',
      token_type: 'Bearer',
      expires_in: 300,
    });
  }),
];
