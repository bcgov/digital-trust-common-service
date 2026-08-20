import type { ComponentType } from 'react';
import { Navigate, type RouteObject } from 'react-router';

import { AppShell } from '@/layouts/AppShell';
import { RootLayout } from '@/layouts/RootLayout';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { RouteErrorPage } from '@/pages/RouteErrorPage';

import { RequireAuth } from './require-auth';

// Pages are code-split via route-level lazy(); layouts and the error page stay
// in the entry chunk so the shell renders without a second round trip.
// A typo in the export name is a compile error, not a navigation-time crash.
function lazyPage<K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
) {
  return async () => ({ Component: (await load())[name] });
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        path: '/login',
        lazy: lazyPage(() => import('@/pages/LoginPage'), 'LoginPage'),
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <Navigate to="/dashboard" replace /> },
              {
                path: '/dashboard',
                lazy: lazyPage(
                  () => import('@/pages/DashboardPage'),
                  'DashboardPage',
                ),
              },
              {
                path: '/tenants',
                lazy: lazyPage(
                  () => import('@/pages/TenantsPage'),
                  'TenantsPage',
                ),
              },
              {
                path: '/tenants/:tenantId',
                lazy: lazyPage(
                  () => import('@/layouts/TenantLayout'),
                  'TenantLayout',
                ),
                children: [
                  {
                    index: true,
                    lazy: lazyPage(
                      () => import('@/pages/TenantOverviewPage'),
                      'TenantOverviewPage',
                    ),
                  },
                  {
                    path: 'users',
                    element: <PlaceholderPage title="Users" issue={86} />,
                  },
                  {
                    path: 'connections',
                    element: <PlaceholderPage title="Connections" issue={87} />,
                  },
                  {
                    path: 'credentials',
                    element: (
                      <PlaceholderPage
                        title="Credential operations"
                        issue={85}
                      />
                    ),
                  },
                  {
                    path: 'audit-logs',
                    element: <PlaceholderPage title="Audit logs" issue={88} />,
                  },
                  {
                    path: 'logs',
                    element: <PlaceholderPage title="Logs" issue={89} />,
                  },
                  {
                    path: 'settings',
                    // Deliberately no issue number: unlike #85-#89, no tenant
                    // settings issue exists yet.
                    element: <PlaceholderPage title="Tenant settings" />,
                  },
                ],
              },
              {
                path: '/settings',
                lazy: lazyPage(
                  () => import('@/pages/SettingsPage'),
                  'SettingsPage',
                ),
              },
            ],
          },
        ],
      },
      {
        path: '*',
        lazy: lazyPage(() => import('@/pages/NotFoundPage'), 'NotFoundPage'),
      },
    ],
  },
];
