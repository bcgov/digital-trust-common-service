import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { I18nProvider } from 'react-aria-components';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { AuthProvider } from '@/lib/auth/auth-context';

export function RootLayout() {
  const { i18n } = useTranslation();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <I18nProvider locale={i18n.language}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Outlet />
        </AuthProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
}
