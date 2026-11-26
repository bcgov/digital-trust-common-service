import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { AccessDenied } from '@/components/common/access-denied';
import { LoadError, LoadingMessage } from '@/components/common/query-status';
import { CreateIssuanceProfileForm } from '@/components/issuance-profile/create-issuance-profile-form';
import { useCredentialDefinitions } from '@/lib/api/queries/credential-definitions';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

export function CreateIssuanceProfilePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tenant, status, refetch } = useActiveTenant();
  const navigate = useNavigate();
  const canManage = hasScope(user, 'profiles:manage');
  const canReadDefinitions = hasScope(user, TENANT_ADMIN_SCOPE);
  const definitions = useCredentialDefinitions(tenant?.id, {
    enabled: canManage && canReadDefinitions,
  });
  const leave = () => void navigate('/issuance-profiles');

  if (!canManage || !canReadDefinitions) {
    return (
      <AccessDenied
        title={t('issuanceProfiles.create.title')}
        headingLevel={1}
        description={t(
          canManage
            ? 'issuanceProfiles.definitionsRestricted'
            : 'issuanceProfiles.forbidden',
        )}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      {(!tenant || !definitions.isSuccess) && (
        <h1 className="text-h1 font-bold text-black">
          {t('issuanceProfiles.create.title')}
        </h1>
      )}
      {(status === 'loading' || (tenant && definitions.isLoading)) && (
        <LoadingMessage>{t('credentialDefinitions.loading')}</LoadingMessage>
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
      {tenant && definitions.isError && (
        <LoadError
          message={t('credentialDefinitions.loadFailed')}
          onRetry={() => void definitions.refetch()}
        />
      )}
      {tenant && definitions.isSuccess && (
        <CreateIssuanceProfileForm
          key={tenant.id}
          tenantId={tenant.id}
          definitions={definitions.data.data}
          onClose={leave}
          onCreated={leave}
        />
      )}
    </div>
  );
}
