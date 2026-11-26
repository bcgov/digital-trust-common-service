import {
  Button,
  Select,
  TextField,
} from '@bcgov/design-system-react-components';
import { useId } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { PlusIcon, TrashIcon } from '@/components/common/icons';

import {
  validateValueRule,
  type ClaimValueRule,
  type ClaimValueType,
} from './claim-value-rules';

export function ClaimValueRuleEditor({
  name,
  type,
  rule,
  isDisabled,
  onChange,
}: {
  name: string;
  type: ClaimValueType;
  rule: ClaimValueRule | undefined;
  isDisabled: boolean;
  onChange: (rule: ClaimValueRule | undefined) => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const validation = rule && validateValueRule(rule, type);

  return (
    <div className="flex flex-col gap-3 rounded-(--layout-border-radius-medium) border border-(--surface-color-border-default) p-4">
      <div>
        <div
          id={labelId}
          className="py-(--layout-padding-xsmall) text-small-body text-(--typography-color-secondary)"
        >
          <Trans
            i18nKey="issuanceProfiles.valueRules.ruleFor"
            values={{ name }}
            components={{ claim: <strong /> }}
          />
        </div>
        <Select
          aria-labelledby={labelId}
          isDisabled={isDisabled}
          value={rule?.mode ?? 'any'}
          items={(['any', 'enum', 'const'] as const).map((mode) => ({
            id: mode,
            label: t(`issuanceProfiles.valueRules.modes.${mode}`),
          }))}
          onChange={(mode) => {
            if (mode === 'any') onChange(undefined);
            else if (mode === 'enum' || mode === 'const') {
              if (mode === rule?.mode) return;
              onChange({ mode, values: [rule?.values[0] ?? ''] });
            }
          }}
        />
      </div>
      {rule && (
        <>
          <p className="text-small-body text-(--typography-color-secondary)">
            {t(`issuanceProfiles.valueRules.hints.${type}`)}
          </p>
          {rule.values.map((value, index) => {
            const valueValidation = validateValueRule(
              { mode: 'const', values: [value] },
              type,
            );
            return (
              <div key={index} className="flex items-end gap-3">
                <TextField
                  className="min-w-0 flex-1"
                  label={t('issuanceProfiles.valueRules.valueFor', {
                    name,
                    index: index + 1,
                  })}
                  value={value}
                  isDisabled={isDisabled}
                  isInvalid={!valueValidation.valid}
                  errorMessage={t('issuanceProfiles.valueRules.invalid')}
                  onChange={(next) =>
                    onChange({
                      ...rule,
                      values: rule.values.map((item, itemIndex) =>
                        itemIndex === index ? next : item,
                      ),
                    })
                  }
                />
                {rule.mode === 'enum' && (
                  <Button
                    type="button"
                    variant="tertiary"
                    isIconButton
                    isDisabled={isDisabled}
                    aria-label={t('issuanceProfiles.valueRules.remove', {
                      name,
                      index: index + 1,
                    })}
                    onPress={() =>
                      onChange({
                        ...rule,
                        values: rule.values.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      })
                    }
                  >
                    <TrashIcon className="size-5" />
                  </Button>
                )}
              </div>
            );
          })}
          {rule.mode === 'enum' && (
            <div>
              <Button
                type="button"
                variant="primary"
                isDisabled={isDisabled}
                onPress={() =>
                  onChange({ ...rule, values: [...rule.values, ''] })
                }
              >
                <PlusIcon className="size-5" />
                {t('issuanceProfiles.valueRules.add')}
              </Button>
            </div>
          )}
          {validation &&
            !validation.valid &&
            validation.reason !== 'invalid' && (
              <p
                role="alert"
                className="text-small-body text-(--typography-color-danger)"
              >
                {t(
                  validation.reason === 'empty'
                    ? 'issuanceProfiles.valueRules.empty'
                    : 'issuanceProfiles.valueRules.duplicate',
                )}
              </p>
            )}
        </>
      )}
    </div>
  );
}
