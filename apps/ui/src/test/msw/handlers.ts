import { http, HttpResponse } from 'msw';

import { API_BASE_PATH } from '@/lib/api/constants';
import type { Tenant } from '@/lib/api/resources/tenants';
import { MOCK_AUTH_TENANTS } from '@/lib/auth/mock-auth';

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
    status: 'suspended',
    created_at: '2026-02-20T10:00:00.000Z',
    updated_at: '2026-02-20T10:00:00.000Z',
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

/** JWT-shaped mock AT so OIDC switchTenant can decode tenant_id / roles. */
function mockSwitchedAccessToken(tenantId: string | undefined): string {
  return [
    encodeJwtSegment({ alg: 'none', typ: 'JWT' }),
    encodeJwtSegment({
      tenant_id: tenantId,
      roles: ['admin'],
    }),
    'sig',
  ].join('.');
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
  // Same fixture the mock auth client serves, so the two stay in lockstep.
  http.get(`${API_BASE_PATH}/auth/tenants`, () =>
    HttpResponse.json(MOCK_AUTH_TENANTS),
  ),
  http.post(`${API_BASE_PATH}/auth/switch-tenant`, async ({ request }) => {
    const body = (await request.json()) as { tenant_id?: string };
    return HttpResponse.json({
      access_token: mockSwitchedAccessToken(body.tenant_id),
      refresh_token: 'mock-refresh',
      token_type: 'Bearer',
      expires_in: 300,
    });
  }),
];
