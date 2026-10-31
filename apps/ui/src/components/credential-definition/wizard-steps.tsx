import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
                    index <= currentStep ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full border-2 text-sm font-semibold',
                    complete || current
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground',
                  )}
                >
                  {complete ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    'whitespace-nowrap text-sm',
                    current ? 'font-semibold' : 'text-muted-foreground',
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
