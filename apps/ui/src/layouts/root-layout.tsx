import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Outlet } from 'react-router';

import { AuthProvider } from '@/lib/auth/auth-context';

export function RootLayout() {
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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </QueryClientProvider>
  );
}
