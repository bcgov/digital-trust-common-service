import { LoadError } from '@/components/common/query-status';
import { Skeleton } from '@/components/common/skeleton';
import { StatusBadge } from '@/components/common/status-badge';
import { useTenantOnboarding } from '@/lib/api/queries/tenants';
import { TENANT_ONBOARDING_STEP_CONTENT } from '@/lib/tenant/onboarding-steps';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function TenantOnboardingChecklist({
  tenantId,
}: {
  tenantId: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const query = useTenantOnboarding(tenantId);

  if (!tenantId) return null;

  if (query.isLoading) {
    return <Skeleton className="h-48 w-full" />;
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

  if (!query.data) return null;

  const { steps, progress_percent: progressPercent } = query.data;
  const completeCount = steps.filter((step) => step.completed).length;
  const allComplete = completeCount === steps.length;
  const nextStep = steps.find(
    (step) => !step.completed && step.blocked_by.length === 0,
  );
  const listFormatter = new Intl.ListFormat(i18n.language, {
    style: 'long',
    type: 'conjunction',
  });

  return (
    <section
      aria-labelledby="tenant-onboarding-title"
      className="flex flex-col gap-(--layout-margin-small) rounded-(--layout-border-radius-large) border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-(--layout-padding-small)"
    >
      <header className="flex flex-wrap items-center justify-between gap-(--layout-margin-small)">
        <div className="flex min-w-0 flex-col gap-(--layout-margin-xsmall)">
          <h2
            id="tenant-onboarding-title"
            className="text-h5 font-bold text-black"
          >
            {t(
              allComplete
                ? 'tenantOnboarding.completeTitle'
                : 'tenantOnboarding.title',
            )}
          </h2>
          <p className="text-small-body text-(--typography-color-secondary)">
            {t(
              allComplete
                ? 'tenantOnboarding.completeReason'
                : 'tenantOnboarding.reason',
            )}
          </p>
        </div>
        {allComplete && (
          <StatusBadge
            label={t('tenantOnboarding.status.complete')}
            tone="success"
          />
        )}
      </header>

      <div className="flex flex-col gap-(--layout-margin-small) sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-(--layout-margin-xsmall)">
          <div className="flex items-baseline justify-between gap-(--layout-margin-small)">
            <p
              id="tenant-onboarding-progress-label"
              className="text-small-body"
            >
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
            aria-labelledby="tenant-onboarding-progress-label"
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
        {nextStep && (
          <Link
            to={`/tenants/${tenantId}/setup`}
            className="bcds-react-aria-Button medium primary shrink-0"
          >
            {t('tenantOnboarding.continueSetup')}
          </Link>
        )}
      </div>

      <ol
        aria-label={t('tenantOnboarding.stepsLabel')}
        className="grid gap-x-(--layout-margin-large) md:grid-cols-2"
      >
        {steps.map((step) => {
          const content = TENANT_ONBOARDING_STEP_CONTENT[step.name];
          const isBlocked = !step.completed && step.blocked_by.length > 0;
          const statusLabel = step.completed
            ? t('tenantOnboarding.status.complete')
            : isBlocked
              ? t('tenantOnboarding.status.blocked')
              : t('tenantOnboarding.status.needsSetup');

          return (
            <li
              key={step.name}
              className="flex min-w-0 flex-col gap-(--layout-margin-xsmall) border-t border-(--surface-color-border-default) py-(--layout-padding-small)"
            >
              <div className="flex flex-wrap items-center gap-(--layout-margin-small)">
                <h3 className="text-body font-bold text-black">
                  {t(content.title)}
                </h3>
                <StatusBadge
                  label={statusLabel}
                  tone={
                    step.completed
                      ? 'success'
                      : isBlocked
                        ? 'neutral'
                        : 'pending'
                  }
                  showCheck={false}
                />
              </div>
              <p className="text-small-body text-(--typography-color-secondary)">
                {t(content.reason)}
              </p>
              {isBlocked && (
                <p className="text-small-body text-(--typography-color-secondary)">
                  {t('tenantOnboarding.requires', {
                    steps: listFormatter.format(
                      step.blocked_by.map((name) =>
                        t(TENANT_ONBOARDING_STEP_CONTENT[name].title),
                      ),
                    ),
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
