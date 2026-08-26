import { http, HttpResponse } from 'msw';

import { API_BASE_PATH } from '@/lib/api/constants';
import type { Tenant } from '@/lib/api/resources/tenants';

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
  http.get(`${API_BASE_PATH}/auth/tenants`, () =>
    HttpResponse.json([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Acme Ministry',
        slug: 'acme-ministry',
        role: 'owner',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Example Agency',
        slug: 'example-agency',
        role: 'admin',
      },
    ]),
  ),
  http.post(`${API_BASE_PATH}/auth/switch-tenant`, async ({ request }) => {
    const body = (await request.json()) as { tenant_id?: string };
    return HttpResponse.json({
      access_token: `switched-${body.tenant_id}`,
      refresh_token: 'mock-refresh',
      token_type: 'Bearer',
      expires_in: 300,
    });
  }),
];
