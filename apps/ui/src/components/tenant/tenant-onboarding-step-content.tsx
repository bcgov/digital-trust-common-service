import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/common/status-badge';
import type { useCreateConnectorForm } from '@/components/connector/use-create-connector-form';
import type { TenantOnboarding } from '@/lib/api/resources/tenants';
import {
  ApiClientRegistrationStep,
  ConnectorSetupStep,
  CredentialDefinitionRegistrationStep,
  IssuanceProfileSetupStep,
} from './tenant-onboarding-step-panels';
import type { TenantOnboardingSetupState } from './use-tenant-onboarding-setup';

interface TenantOnboardingStepContentProps {
  tenantId: string;
  step: TenantOnboarding['steps'][number];
  content: {
    title: ParseKeys;
    reason: ParseKeys;
    action: ParseKeys;
  };
  isBlocked: boolean;
  blockedSteps: string;
  canManageConnectors: boolean;
  canCreateIssuanceProfile: boolean;
  canManageApiClients: boolean;
  connectorForm: ReturnType<typeof useCreateConnectorForm>;
  setup: TenantOnboardingSetupState;
  onSaveForLater: () => void;
}

export function TenantOnboardingStepContent({
  tenantId,
  step,
  content,
  isBlocked,
  blockedSteps,
  canManageConnectors,
  canCreateIssuanceProfile,
  canManageApiClients,
  connectorForm,
  setup,
  onSaveForLater,
}: TenantOnboardingStepContentProps) {
  const { t } = useTranslation();
  const stepPanel = (() => {
    switch (step.name) {
      case 'configure-connector':
        return (
          <ConnectorSetupStep
            canManageConnectors={canManageConnectors}
            connectorForm={connectorForm}
            tenantId={tenantId}
            onSaveForLater={onSaveForLater}
          />
        );
      case 'register-credential-definition':
        return (
          <CredentialDefinitionRegistrationStep
            tenantId={tenantId}
            registration={setup.registration}
            definitionsQuery={setup.definitionsQuery}
            onSaveForLater={onSaveForLater}
          />
        );
      case 'create-issuance-profile':
        return (
          <IssuanceProfileSetupStep
            tenantId={tenantId}
            canCreateIssuanceProfile={canCreateIssuanceProfile}
            definitionsQuery={setup.definitionsQuery}
            issuanceProfile={setup.issuanceProfile}
            onSaveForLater={onSaveForLater}
          />
        );
      case 'register-api-client':
        return (
          <ApiClientRegistrationStep
            tenantId={tenantId}
            canManageApiClients={canManageApiClients}
            apiClient={setup.apiClient}
            onSaveForLater={onSaveForLater}
          />
        );
    }
  })();

  return (
    <section
      aria-labelledby="wizard-step-title"
      className="flex min-w-0 flex-col items-start gap-(--layout-margin-small) border-t border-(--surface-color-border-default) py-(--layout-padding-medium) lg:border-t-0 lg:border-l lg:pl-(--layout-padding-large)"
    >
      <StatusBadge
        label={t(
          step.completed
            ? 'tenantOnboarding.status.complete'
            : isBlocked
              ? 'tenantOnboarding.status.blocked'
              : 'tenantOnboarding.status.needsSetup',
        )}
        tone={step.completed ? 'success' : isBlocked ? 'neutral' : 'pending'}
        showCheck={false}
      />
      <h2 id="wizard-step-title" className="text-h4 font-bold text-black">
        {t(content.title)}
      </h2>
      <p className="text-body text-(--typography-color-secondary)">
        {t(content.reason)}
      </p>
      {step.completed ? (
        <p className="text-body text-(--typography-color-secondary)">
          {t('tenantOnboarding.completeStep')}
        </p>
      ) : isBlocked ? (
        <p className="text-body text-(--typography-color-secondary)">
          {t('tenantOnboarding.requires', { steps: blockedSteps })}
        </p>
      ) : (
        stepPanel
      )}
    </section>
  );
}
