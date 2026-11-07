import { useTranslation } from 'react-i18next';

import { CheckIcon } from '@/components/common/icons';
import { cn } from '@/lib/utils';

interface WizardStepsProps {
  steps: readonly string[];
  currentStep: number;
}

export function WizardSteps({ steps, currentStep }: WizardStepsProps) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('credentialDefinitions.wizard.progress')}
      className="mx-auto w-full max-w-4xl px-4"
    >
      <ol className="flex items-center">
        {steps.map((label, index) => {
          const complete = index < currentStep;
          const current = index === currentStep;
          return (
            <li
              key={label}
              aria-current={current ? 'step' : undefined}
              className={cn('flex items-center', index > 0 && 'flex-1')}
            >
              {index > 0 && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'mx-3 h-0.5 min-w-4 flex-1',
                    index <= currentStep
                      ? 'bg-(--surface-color-primary-default)'
                      : 'bg-(--surface-color-border-default)',
                  )}
                />
              )}
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full border-2 text-small-body font-bold',
                    complete || current
                      ? 'border-(--surface-color-primary-default) bg-(--surface-color-primary-default) text-(--typography-color-primary-invert)'
                      : 'border-(--surface-color-border-default) bg-(--surface-color-background-white) text-(--typography-color-secondary)',
                  )}
                >
                  {complete ? <CheckIcon className="size-4" /> : index + 1}
                </span>
                <span
                  className={cn(
                    'whitespace-nowrap text-small-body',
                    current
                      ? 'font-bold text-(--typography-color-primary)'
                      : 'text-(--typography-color-secondary)',
                  )}
                >
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
