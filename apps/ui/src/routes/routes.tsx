import type { ComponentType } from 'react';
import { Navigate, type RouteObject } from 'react-router';

import { AppShell } from '@/layouts/app-shell';
import { RootLayout } from '@/layouts/root-layout';
import { AUTH_CALLBACK_PATH, POST_LOGOUT_PATH } from '@/lib/auth/constants';
import { PlaceholderPage } from '@/pages/placeholder-page';
import { RouteErrorPage } from '@/pages/route-error-page';

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
        path: POST_LOGOUT_PATH,
        lazy: lazyPage(() => import('@/pages/login-page'), 'LoginPage'),
      },
      {
        // Outside RequireAuth: the redirect arrives before a session exists.
        path: AUTH_CALLBACK_PATH,
        lazy: lazyPage(
          () => import('@/pages/auth-callback-page'),
          'AuthCallbackPage',
        ),
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
                  () => import('@/pages/dashboard-page'),
                  'DashboardPage',
                ),
              },
              {
                path: '/tenants',
                lazy: lazyPage(
                  () => import('@/pages/tenants-page'),
                  'TenantsPage',
                ),
              },
              {
                path: '/connectors',
                lazy: lazyPage(
                  () => import('@/pages/connectors-page'),
                  'ConnectorsPage',
                ),
              },
              {
                path: '/tenants/:tenantId',
                lazy: lazyPage(
                  () => import('@/layouts/tenant-layout'),
                  'TenantLayout',
                ),
                children: [
                  {
                    index: true,
                    lazy: lazyPage(
                      () => import('@/pages/tenant-overview-page'),
                      'TenantOverviewPage',
                    ),
                  },
                  {
                    path: 'users',
                    lazy: lazyPage(
                      () => import('@/pages/tenant-users-page'),
                      'TenantUsersPage',
                    ),
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
              ...(import.meta.env.DEV
                ? [
                    {
                      path: '/dev/dialogs',
                      lazy: lazyPage(
                        () => import('@/demo/dialog-demo-page'),
                        'DialogDemoPage',
                      ),
                    },
                    {
                      path: '/dev/toasts',
                      lazy: lazyPage(
                        () => import('@/demo/ToastDemoPage'),
                        'ToastDemoPage',
                      ),
                    },
                  ]
                : []),
            ],
          },
        ],
      },
      {
        path: '*',
        lazy: lazyPage(() => import('@/pages/not-found-page'), 'NotFoundPage'),
      },
    ],
  },
];
