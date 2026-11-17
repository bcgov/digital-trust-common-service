import { LoadError } from '@/components/common/query-status';
import { Skeleton } from '@/components/common/skeleton';
import { StatusBadge } from '@/components/common/status-badge';
import { ApiClientSecret } from '@/components/api-client/api-client-secret';
import { useCreateConnectorForm } from '@/components/connector/use-create-connector-form';
import { TenantOnboardingStepContent } from '@/components/tenant/tenant-onboarding-step-content';
import { useTenantOnboardingSetup } from '@/components/tenant/use-tenant-onboarding-setup';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { TENANT_ONBOARDING_STEP_CONTENT } from '@/lib/tenant/onboarding-steps';
import type { TenantOnboardingStepName } from '@/lib/tenant/onboarding-steps';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

const CLIENTS_MANAGE_SCOPE = 'clients:manage';

export function TenantOnboardingSetupPage() {
  const { t, i18n } = useTranslation();
  const { tenantId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManageConnectors = hasScope(user, TENANT_ADMIN_SCOPE);
  const canCreateIssuanceProfile =
    hasScope(user, 'profiles:manage') && hasScope(user, TENANT_ADMIN_SCOPE);
  const canManageApiClients = hasScope(user, CLIENTS_MANAGE_SCOPE);
  const [selectedStepName, setSelectedStepName] =
    useState<TenantOnboardingStepName>();
  const connectorForm = useCreateConnectorForm({
    tenantId,
    onCreated: () => setSelectedStepName(undefined),
  });
  const setup = useTenantOnboardingSetup({
    tenantId,
    canManageConnectors,
    onStepReset: () => setSelectedStepName(undefined),
  });
  const { query } = setup;
  const saveForLater = () => void navigate(`/tenants/${tenantId}`);
  if (!tenantId) return null;

  if (setup.apiClient.credentials) {
    return (
      <div className="flex flex-col gap-(--layout-margin-large)">
        <header className="flex flex-col gap-(--layout-margin-xsmall)">
          <h1 className="text-h1 font-bold text-black">
            {t('tenantOnboarding.title')}
          </h1>
          <p className="text-body text-(--typography-color-secondary)">
            {t('tenantOnboarding.reason')}
          </p>
        </header>
        <section
          aria-labelledby="api-client-credentials-title"
          className="flex max-w-2xl flex-col gap-(--layout-margin-medium) border-t border-(--surface-color-border-default) py-(--layout-padding-medium)"
        >
          <h2
            id="api-client-credentials-title"
            className="text-h4 font-bold text-black"
          >
            {t('apiClients.drawer.credentialsTitle')}
          </h2>
          <ApiClientSecret
            credentials={setup.apiClient.credentials}
            onDone={setup.apiClient.onAcknowledgeCredentials}
            embedded
          />
        </section>
      </div>
    );
  }

  if (query.isLoading) {
    return <Skeleton className="h-72 w-full" />;
  }

  if (query.error) {
    return (
      <LoadError
        message={t('tenantOnboarding.loadFailedWithReason', {
          reason: query.error.message,
        })}
        onRetry={() => void query.refetch()}
        retryLabel={t('tenantOnboarding.retry')}
      />
    );
  }

  const readiness = query.data;
  if (!readiness) return null;

  const { steps, progress_percent: progressPercent } = readiness;
  const completeCount = steps.filter((step) => step.completed).length;
  const allComplete = completeCount === steps.length;
  const nextStep = steps.find(
    (step) => !step.completed && step.blocked_by.length === 0,
  );
  const selectedStep = steps.find(
    (step) =>
      step.name === selectedStepName &&
      (step.completed || step.blocked_by.length === 0),
  );
  const activeStep = selectedStep ?? nextStep ?? steps[0];

  if (!activeStep) return null;

  const activeContent = TENANT_ONBOARDING_STEP_CONTENT[activeStep.name];
  const isBlocked = !activeStep.completed && activeStep.blocked_by.length > 0;
  const blockedSteps = new Intl.ListFormat(i18n.language, {
    style: 'long',
    type: 'conjunction',
  }).format(
    activeStep.blocked_by.map((name) =>
      t(TENANT_ONBOARDING_STEP_CONTENT[name].title),
    ),
  );

  return (
    <div className="flex flex-col gap-(--layout-margin-large)">
      <header className="flex flex-wrap items-start justify-between gap-(--layout-margin-medium)">
        <div className="flex flex-col gap-(--layout-margin-xsmall)">
          <h1 className="text-h1 font-bold text-black">
            {t('tenantOnboarding.title')}
          </h1>
          <p className="text-body text-(--typography-color-secondary)">
            {t('tenantOnboarding.reason')}
          </p>
        </div>
        <Link
          to={`/tenants/${tenantId}`}
          className="bcds-react-aria-Button medium secondary"
        >
          {t('tenantOnboarding.backToOverview')}
        </Link>
      </header>

      <div className="flex flex-col gap-(--layout-margin-medium)">
        <div className="flex flex-col gap-(--layout-margin-xsmall)">
          <div className="flex items-baseline justify-between gap-(--layout-margin-small)">
            <p id="wizard-progress-label" className="text-small-body">
              {t('tenantOnboarding.progress')}
            </p>
            <p className="text-small-body tabular-nums text-(--typography-color-secondary)">
              {t('tenantOnboarding.progressSummary', {
                completed: completeCount,
                total: steps.length,
              })}
            </p>
          </div>
          <div
            role="progressbar"
            aria-labelledby="wizard-progress-label"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-valuetext={t('tenantOnboarding.progressPercent', {
              percent: progressPercent,
            })}
            className="h-2 overflow-hidden rounded-full bg-(--surface-color-border-default)"
          >
            <div
              className="h-full bg-(--surface-color-primary-button-default) transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {allComplete ? (
          <section className="flex flex-col gap-(--layout-margin-small) border-t border-(--surface-color-border-default) py-(--layout-padding-medium)">
            <StatusBadge
              label={t('tenantOnboarding.status.complete')}
              tone="success"
            />
            <p className="text-body text-black">
              {t('tenantOnboarding.completeReason')}
            </p>
          </section>
        ) : (
          <div className="grid gap-(--layout-margin-large) lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.6fr)]">
            <nav aria-label={t('tenantOnboarding.stepsLabel')}>
              <ol className="flex flex-col">
                {steps.map((step) => {
                  const content = TENANT_ONBOARDING_STEP_CONTENT[step.name];
                  const blocked = !step.completed && step.blocked_by.length > 0;
                  const selected = step.name === activeStep.name;
                  const statusLabel = step.completed
                    ? t('tenantOnboarding.status.complete')
                    : blocked
                      ? t('tenantOnboarding.status.blocked')
                      : t('tenantOnboarding.status.needsSetup');

                  return (
                    <li
                      key={step.name}
                      className="border-t border-(--surface-color-border-default) first:border-t-0"
                    >
                      <button
                        type="button"
                        aria-current={selected ? 'step' : undefined}
                        disabled={blocked}
                        onClick={() => setSelectedStepName(step.name)}
                        className={`flex w-full items-center justify-between gap-(--layout-margin-small) py-(--layout-padding-medium) text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--surface-color-primary-button-default) ${
                          blocked
                            ? 'cursor-not-allowed opacity-60'
                            : 'hover:text-(--typography-color-primary)'
                        } ${selected ? 'font-bold text-(--typography-color-primary)' : 'text-black'}`}
                      >
                        <span className="text-body">{t(content.title)}</span>
                        <StatusBadge
                          label={statusLabel}
                          tone={
                            step.completed
                              ? 'success'
                              : blocked
                                ? 'neutral'
                                : 'pending'
                          }
                          showCheck={false}
                        />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <TenantOnboardingStepContent
              tenantId={tenantId}
              step={activeStep}
              content={activeContent}
              isBlocked={isBlocked}
              blockedSteps={blockedSteps}
              canManageConnectors={canManageConnectors}
              canCreateIssuanceProfile={canCreateIssuanceProfile}
              canManageApiClients={canManageApiClients}
              connectorForm={connectorForm}
              setup={setup}
              onSaveForLater={saveForLater}
            />
          </div>
        )}
      </div>
    </div>
  );
}
