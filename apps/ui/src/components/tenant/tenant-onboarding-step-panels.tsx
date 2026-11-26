import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { LoadError, LoadingMessage } from '@/components/common/query-status';
import { ApiClientDrawer } from '@/components/api-client/api-client-drawer';
import { AddConnectorForm } from '@/components/connector/add-connector-form';
import type { useCreateConnectorForm } from '@/components/connector/use-create-connector-form';
import { CreateIssuanceProfileForm } from '@/components/issuance-profile/create-issuance-profile-form';
import { ApiError } from '@/lib/api/errors';
import { CreateCredentialDefinitionPage } from '@/pages/create-credential-definition-page';

import type { TenantOnboardingSetupState } from './use-tenant-onboarding-setup';

interface SaveForLaterProps {
  tenantId: string;
  onSaveForLater: () => void;
}

interface ConnectorSetupStepProps extends SaveForLaterProps {
  canManageConnectors: boolean;
  connectorForm: ReturnType<typeof useCreateConnectorForm>;
}

interface CredentialDefinitionRegistrationStepProps extends SaveForLaterProps {
  registration: TenantOnboardingSetupState['registration'];
  definitionsQuery: TenantOnboardingSetupState['definitionsQuery'];
}

interface IssuanceProfileSetupStepProps extends SaveForLaterProps {
  canCreateIssuanceProfile: boolean;
  definitionsQuery: TenantOnboardingSetupState['definitionsQuery'];
  issuanceProfile: TenantOnboardingSetupState['issuanceProfile'];
}

interface ApiClientRegistrationStepProps extends SaveForLaterProps {
  canManageApiClients: boolean;
  apiClient: TenantOnboardingSetupState['apiClient'];
}

function SaveForLaterLink({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/tenants/${tenantId}`}
      className="bcds-react-aria-Button medium secondary"
    >
      {t('tenantOnboarding.saveForLater')}
    </Link>
  );
}

export function ConnectorSetupStep({
  canManageConnectors,
  connectorForm,
  onSaveForLater,
}: ConnectorSetupStepProps) {
  const { t } = useTranslation();
  if (!canManageConnectors) {
    return (
      <p className="text-body text-(--typography-color-secondary)">
        {t('tenantOnboarding.connectorAdminRequired')}
      </p>
    );
  }
  return (
    <AddConnectorForm
      embedded
      cancelLabel={t('tenantOnboarding.saveForLater')}
      onSubmit={connectorForm.submit}
      onCancel={onSaveForLater}
      errors={connectorForm.errors}
      mutation={connectorForm.mutation}
      canCreate
    />
  );
}

export function CredentialDefinitionRegistrationStep({
  tenantId,
  registration,
  definitionsQuery,
  onSaveForLater,
}: CredentialDefinitionRegistrationStepProps) {
  const { t } = useTranslation();
  const operationQuery = registration.operationQuery;

  if (registration.failed) {
    return (
      <div className="flex flex-col items-start gap-(--layout-margin-small)">
        <InlineAlert
          variant="danger"
          role="alert"
          title={t('tenantOnboarding.registrationFailed')}
          description={registration.failureDetail}
        />
        <Link
          to="/credential-definitions"
          className="bcds-react-aria-Button medium primary"
        >
          {t('tenantOnboarding.manageCredentialDefinitions')}
        </Link>
        <SaveForLaterLink tenantId={tenantId} />
      </div>
    );
  }

  if (operationQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-(--layout-margin-small)">
        <LoadError
          message={t('tenantOnboarding.registrationStatusLoadFailed')}
          onRetry={() => void operationQuery.refetch()}
          retryLabel={t('common.retry')}
        />
        <Link
          to="/credential-definitions"
          className="bcds-react-aria-Button medium secondary"
        >
          {t('tenantOnboarding.manageCredentialDefinitions')}
        </Link>
      </div>
    );
  }

  if (registration.inProgress || registration.readinessPending) {
    return (
      <div className="flex flex-col items-start gap-(--layout-margin-small)">
        <p
          role="status"
          className="text-body text-(--typography-color-secondary)"
        >
          {t('tenantOnboarding.registrationPending')}
        </p>
        <SaveForLaterLink tenantId={tenantId} />
      </div>
    );
  }

  if (definitionsQuery.isLoading) {
    return (
      <LoadingMessage>{t('credentialDefinitions.loading')}</LoadingMessage>
    );
  }

  if (definitionsQuery.error && !definitionsQuery.data) {
    return (
      <LoadError
        message={t('credentialDefinitions.loadFailed')}
        onRetry={() => void definitionsQuery.refetch()}
        retryLabel={t('common.retry')}
      />
    );
  }

  return (
    <CreateCredentialDefinitionPage
      embedded
      exitLabel={t('tenantOnboarding.saveForLater')}
      onExit={onSaveForLater}
      onRegistrationStarted={registration.onStarted}
    />
  );
}

export function IssuanceProfileSetupStep({
  tenantId,
  canCreateIssuanceProfile,
  definitionsQuery,
  issuanceProfile,
  onSaveForLater,
}: IssuanceProfileSetupStepProps) {
  const { t } = useTranslation();
  const pendingProfile = issuanceProfile.current;
  const mutation = issuanceProfile.mutation;

  if (!canCreateIssuanceProfile) {
    return (
      <p className="text-body text-(--typography-color-secondary)">
        {t('tenantOnboarding.issuanceProfileAdminRequired')}
      </p>
    );
  }

  if (pendingProfile?.status === 'published') {
    return (
      <div className="flex flex-col items-start gap-(--layout-margin-small)">
        <LoadingMessage>
          {t('tenantOnboarding.profileReadinessPending')}
        </LoadingMessage>
        <SaveForLaterLink tenantId={tenantId} />
      </div>
    );
  }

  if (pendingProfile && mutation.isError) {
    return (
      <div className="flex flex-col items-start gap-(--layout-margin-small)">
        <LoadError
          message={
            mutation.error instanceof ApiError
              ? mutation.error.message
              : t('tenantOnboarding.publishProfileFailed')
          }
          onRetry={() => issuanceProfile.publishDraft(pendingProfile.profileId)}
          retryLabel={t('tenantOnboarding.retryPublish')}
        />
        <SaveForLaterLink tenantId={tenantId} />
      </div>
    );
  }

  if (pendingProfile && mutation.isPending) {
    return (
      <div className="flex flex-col items-start gap-(--layout-margin-small)">
        <LoadingMessage>
          {t('tenantOnboarding.publishingProfile')}
        </LoadingMessage>
        <SaveForLaterLink tenantId={tenantId} />
      </div>
    );
  }

  if (pendingProfile) {
    return (
      <div className="flex flex-col items-start gap-(--layout-margin-small)">
        <Button
          onPress={() => issuanceProfile.publishDraft(pendingProfile.profileId)}
        >
          {t('tenantOnboarding.retryPublish')}
        </Button>
        <SaveForLaterLink tenantId={tenantId} />
      </div>
    );
  }

  if (definitionsQuery.isLoading) {
    return (
      <LoadingMessage>{t('credentialDefinitions.loading')}</LoadingMessage>
    );
  }

  if (definitionsQuery.error) {
    return (
      <LoadError
        message={t('credentialDefinitions.loadFailed')}
        onRetry={() => void definitionsQuery.refetch()}
        retryLabel={t('common.retry')}
      />
    );
  }

  return (
    <CreateIssuanceProfileForm
      tenantId={tenantId}
      definitions={definitionsQuery.data?.data ?? []}
      onCreated={issuanceProfile.onCreated}
      onClose={onSaveForLater}
      embedded
    />
  );
}

export function ApiClientRegistrationStep({
  tenantId,
  canManageApiClients,
  apiClient,
  onSaveForLater,
}: ApiClientRegistrationStepProps) {
  const { t } = useTranslation();
  if (!canManageApiClients) {
    return (
      <p className="text-body text-(--typography-color-secondary)">
        {t('tenantOnboarding.apiClientAdminRequired')}
      </p>
    );
  }

  if (apiClient.readinessPending) {
    return (
      <div className="flex flex-col items-start gap-(--layout-margin-small)">
        <LoadingMessage>
          {t('tenantOnboarding.apiClientReadinessPending')}
        </LoadingMessage>
        <SaveForLaterLink tenantId={tenantId} />
      </div>
    );
  }

  return (
    <ApiClientDrawer
      tenantId={tenantId}
      embedded
      fixedGrantTypes={['client_credentials']}
      cancelLabel={t('tenantOnboarding.saveForLater')}
      onClose={onSaveForLater}
      onCredentialsCreated={apiClient.onCredentialsCreated}
    />
  );
}
