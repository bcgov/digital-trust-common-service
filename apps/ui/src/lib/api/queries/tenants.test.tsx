import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { mockTenantOnboarding } from '@/mocks/handlers';

import { tenantKeys, useTenantOnboarding } from './tenants';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('useTenantOnboarding', () => {
  it('fetches and caches readiness for the requested tenant', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useTenantOnboarding(tenantId), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockTenantOnboarding);
    expect(queryClient.getQueryData(tenantKeys.onboarding(tenantId))).toEqual(
      mockTenantOnboarding,
    );
  });

  it('does not fetch when no tenant is selected', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useTenantOnboarding(undefined), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(queryClient.getQueryData(tenantKeys.onboarding(''))).toBeUndefined();
  });
});
