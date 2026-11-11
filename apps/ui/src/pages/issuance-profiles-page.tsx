import { Button } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import { AccessDenied } from '@/components/common/access-denied';
import { EmptyState } from '@/components/common/empty';
import { AddressCardIcon } from '@/components/common/icons';
import { PageHeader } from '@/components/common/page-header';
import { LoadError, LoadingMessage } from '@/components/common/query-status';
import { CreateIssuanceProfileButton } from '@/components/issuance-profile/create-issuance-profile-button';
import { IssuanceProfilesTable } from '@/components/issuance-profile/issuance-profiles-table';
import { useCredentialDefinitions } from '@/lib/api/queries/credential-definitions';
import { useIssuanceProfiles } from '@/lib/api/queries/issuance-profiles';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

export function IssuanceProfilesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tenant, status, refetch } = useActiveTenant();
  const canManage = hasScope(user, 'profiles:manage');
  const canReadDefinitions = canManage && hasScope(user, TENANT_ADMIN_SCOPE);
  const profilesQuery = useIssuanceProfiles(tenant?.id, {
    enabled: canManage,
  });
  const definitionsQuery = useCredentialDefinitions(tenant?.id, {
    enabled: canReadDefinitions,
  });
  const profiles = profilesQuery.data?.pages.flatMap((page) => page.data) ?? [];

  if (!canManage) {
    return (
      <AccessDenied
        title={t('issuanceProfiles.title')}
        headingLevel={1}
        description={t('issuanceProfiles.forbidden')}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-xlarge">
      <PageHeader
        title={t('issuanceProfiles.title')}
        actions={
          tenant &&
          canReadDefinitions &&
          definitionsQuery.isSuccess && (
            <CreateIssuanceProfileButton
              key={tenant.id}
              tenantId={tenant.id}
              definitions={definitionsQuery.data.data}
            />
          )
        }
      />
      {(status === 'loading' || (tenant && profilesQuery.isLoading)) && (
        <LoadingMessage>{t('issuanceProfiles.loading')}</LoadingMessage>
      )}
      {status === 'error' && (
        <LoadError
          message={t('credentialDefinitions.membershipsLoadFailed')}
          onRetry={refetch}
        />
      )}
      {status === 'ready' && !tenant && (
        <LoadingMessage>
          {t('credentialDefinitions.noActiveTenant')}
        </LoadingMessage>
      )}
      {tenant && profilesQuery.isError && (
        <LoadError
          message={t('issuanceProfiles.loadFailed')}
          onRetry={() => {
            if (profilesQuery.isFetchNextPageError) {
              void profilesQuery.fetchNextPage();
            } else {
              void profilesQuery.refetch();
            }
          }}
        />
      )}
      {tenant && canReadDefinitions && definitionsQuery.isLoading && (
        <LoadingMessage>{t('credentialDefinitions.loading')}</LoadingMessage>
      )}
      {tenant && canReadDefinitions && definitionsQuery.isError && (
        <LoadError
          message={t('credentialDefinitions.loadFailed')}
          onRetry={() => void definitionsQuery.refetch()}
        />
      )}
      {tenant && profiles.length > 0 && (
        <>
          {!canReadDefinitions && (
            <p role="status">{t('issuanceProfiles.definitionsRestricted')}</p>
          )}
          <IssuanceProfilesTable
            key={tenant.id}
            tenantId={tenant.id}
            profiles={profiles}
            definitions={
              canReadDefinitions ? (definitionsQuery.data?.data ?? []) : []
            }
          />
          {profilesQuery.hasNextPage && (
            <div>
              <Button
                variant="secondary"
                isDisabled={profilesQuery.isFetching}
                onPress={() => void profilesQuery.fetchNextPage()}
              >
                {profilesQuery.isFetchingNextPage
                  ? t('issuanceProfiles.loading')
                  : t('issuanceProfiles.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
      {tenant && profilesQuery.isSuccess && profiles.length === 0 && (
        <EmptyState
          icon={<AddressCardIcon />}
          title={t('issuanceProfiles.emptyTitle')}
          description={t('issuanceProfiles.emptyBody')}
        />
      )}
    </div>
  );
}
