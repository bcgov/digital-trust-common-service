import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { AccessDenied } from '@/components/common/access-denied';
import { BackLink } from '@/components/common/back-link';
import { LoadError, LoadingMessage } from '@/components/common/query-status';
import { CreateIssuanceProfileForm } from '@/components/issuance-profile/create-issuance-profile-form';
import {
  useCredentialDefinition,
  useCredentialDefinitions,
} from '@/lib/api/queries/credential-definitions';
import { useIssuanceProfile } from '@/lib/api/queries/issuance-profiles';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { useWorkingTenant } from '@/lib/tenant/active-tenant';

export function CreateIssuanceProfilePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tenant, status, refetch } = useWorkingTenant();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const profileId = searchParams.get('id');
  const canManage = hasScope(user, 'profiles:manage');
  const canReadDefinitions = hasScope(user, TENANT_ADMIN_SCOPE);
  const definitions = useCredentialDefinitions(tenant?.id, {
    enabled: canManage && canReadDefinitions && !profileId,
  });
  const profile = useIssuanceProfile(tenant?.id, profileId, {
    enabled: canManage && canReadDefinitions,
  });
  const definition = useCredentialDefinition(
    tenant?.id,
    profile.data?.credential_definition_id ?? null,
    {
      enabled:
        canManage &&
        canReadDefinitions &&
        Boolean(profileId) &&
        profile.data?.status === 'draft',
    },
  );
  const title = t(
    profileId ? 'issuanceProfiles.edit.title' : 'issuanceProfiles.create.title',
  );
  const leave = () => void navigate(`/tenants/${tenant?.id}/issuance-profiles`);

  if (!canManage || !canReadDefinitions) {
    return (
      <AccessDenied
        title={title}
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
      {(!tenant ||
        (profileId
          ? !profile.isSuccess || !definition.isSuccess
          : !definitions.isSuccess)) && (
        <div className="flex flex-col gap-2">
          <BackLink to="/issuance-profiles">
            {t('issuanceProfiles.wizard.backToList')}
          </BackLink>
          <h1 className="text-h1 font-bold text-black">{title}</h1>
        </div>
      )}
      {(status === 'loading' ||
        (tenant &&
          (profileId
            ? profile.isLoading || (profile.isSuccess && definition.isLoading)
            : definitions.isLoading))) && (
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
      {tenant && !profileId && definitions.isError && (
        <LoadError
          message={t('credentialDefinitions.loadFailed')}
          onRetry={() => void definitions.refetch()}
        />
      )}
      {tenant && profileId && profile.isError && (
        <LoadError
          message={t('issuanceProfiles.edit.loadFailed')}
          onRetry={() => void profile.refetch()}
        />
      )}
      {tenant &&
        profileId &&
        profile.isSuccess &&
        (!profile.data.id ||
          !profile.data.credential_definition_id ||
          profile.data.status !== 'draft') && (
          <p role="alert">{t('issuanceProfiles.edit.notEditable')}</p>
        )}
      {tenant &&
        profileId &&
        profile.isSuccess &&
        profile.data.status === 'draft' &&
        definition.isError && (
          <LoadError
            message={t('credentialDefinitions.loadFailed')}
            onRetry={() => void definition.refetch()}
          />
        )}
      {tenant &&
        profileId &&
        profile.isSuccess &&
        profile.data.id &&
        profile.data.credential_definition_id &&
        profile.data.status === 'draft' &&
        definition.isSuccess && (
          <CreateIssuanceProfileForm
            key={`${tenant.id}:${profileId}`}
            tenantId={tenant.id}
            definitions={[definition.data]}
            profile={profile.data}
            onClose={leave}
            onCreated={leave}
          />
        )}
      {tenant && !profileId && definitions.isSuccess && (
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
