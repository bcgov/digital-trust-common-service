import { Button } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import { EditIcon } from '@/components/common/icons';
import { StaticTag } from '@/components/common/static-tag';
import type { Attribute } from '@/components/credential-definition/attributes-step';

export function ReviewStep({
  details,
  attributes,
  onEditDetails,
  onEditAttributes,
}: {
  details: readonly (readonly [string, string])[];
  attributes: readonly Attribute[];
  onEditDetails: () => void;
  onEditAttributes: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-5 px-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h5 font-bold">
          {t('credentialDefinitions.review.title')}
        </h2>
        <p className="text-small-body text-(--typography-color-secondary)">
          {t('credentialDefinitions.review.subtitle')}
        </p>
      </div>
      <section className="flex w-full flex-col gap-medium rounded-(--layout-border-radius-medium) border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-large">
        <div className="flex items-center justify-between">
          <h3 className="text-body font-bold">
            {t('credentialDefinitions.review.details')}
          </h3>
          <Button
            variant="tertiary"
            size="small"
            aria-label={t('credentialDefinitions.review.editDetails')}
            onPress={onEditDetails}
          >
            <EditIcon className="size-4" />
            {t('common.edit')}
          </Button>
        </div>
        <div>
          <dl className="grid grid-cols-2 gap-x-xlarge gap-y-medium text-small-body sm:grid-cols-4">
            {details.map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-1">
                <dt className="text-label text-(--typography-color-secondary)">
                  {label}
                </dt>
                <dd className="break-words font-bold">
                  {value || t('credentialDefinitions.review.emptyValue')}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <section className="flex w-full flex-col gap-medium rounded-(--layout-border-radius-medium) border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-large">
        <div className="flex items-center justify-between">
          <h3 className="text-body font-bold">
            {t('credentialDefinitions.review.attributes')}
          </h3>
          <Button
            variant="tertiary"
            size="small"
            aria-label={t('credentialDefinitions.review.editAttributes')}
            onPress={onEditAttributes}
          >
            <EditIcon className="size-4" />
            {t('common.edit')}
          </Button>
        </div>
        <div>
          {attributes.length === 0 ? (
            <p className="text-small-body text-(--typography-color-secondary)">
              {t('credentialDefinitions.review.noAttributes')}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {attributes.map((attribute) => (
                <li key={attribute.id}>
                  <StaticTag label={attribute.name} color="green" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
