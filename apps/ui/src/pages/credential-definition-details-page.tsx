import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { AccessDenied } from '@/components/common/access-denied';
import { ArrowLeftIcon } from '@/components/common/icons';
import { PageHeader } from '@/components/common/page-header';
import { LoadError, LoadingMessage } from '@/components/common/query-status';
import { CredentialDefinitionDetails } from '@/components/credential-definition/credential-definition-details';
import { ApiError } from '@/lib/api/errors';
import { useCredentialDefinition } from '@/lib/api/queries/credential-definitions';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

export function CredentialDefinitionDetailsPage() {
  const { t } = useTranslation();
  const { definitionId } = useParams();
  const { user } = useAuth();
  const { tenant, status, refetch } = useActiveTenant();
  const canRead = hasScope(user, TENANT_ADMIN_SCOPE);
  const query = useCredentialDefinition(tenant?.id, definitionId ?? null, {
    enabled: canRead,
  });
  const forbidden =
    !canRead || (query.error instanceof ApiError && query.error.status === 403);
  const notFound =
    query.error instanceof ApiError && query.error.status === 404;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-xlarge">
      <Link
        to="/issuance-profiles"
        className="flex w-fit items-center gap-2 underline"
      >
        <ArrowLeftIcon className="size-5" />
        {t('credentialDefinitionDetails.backToProfiles')}
      </Link>
      {forbidden ? (
        <AccessDenied
          title={t('credentialDefinitionDetails.title')}
          headingLevel={1}
          description={t('credentialDefinitions.forbidden')}
        />
      ) : (
        <>
          <PageHeader title={t('credentialDefinitionDetails.title')} />
          {(status === 'loading' || (tenant && query.isLoading)) && (
            <LoadingMessage>
              {t('credentialDefinitions.loading')}
            </LoadingMessage>
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
          {tenant && notFound && (
            <p role="status">{t('credentialDefinitionDetails.notFound')}</p>
          )}
          {tenant && query.isError && !notFound && (
            <LoadError
              message={t('credentialDefinitions.loadFailed')}
              onRetry={() => void query.refetch()}
            />
          )}
          {tenant && query.isSuccess && (
            <CredentialDefinitionDetails definition={query.data} />
          )}
        </>
      )}
    </div>
  );
}
