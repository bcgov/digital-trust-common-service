import { Button } from '@/components/common/button';
import { StatusBadge } from '@/components/common/status-badge';
import { EditIcon } from '@/components/common/icons';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/common/card';
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
        <h2 className="text-lg font-semibold">
          {t('credentialDefinitions.review.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('credentialDefinitions.review.subtitle')}
        </p>
      </div>
      <Card className="w-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="font-bold">
            {t('credentialDefinitions.review.details')}
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-link hover:text-link-hover"
            aria-label={t('credentialDefinitions.review.editDetails')}
            onClick={onEditDetails}
          >
            <EditIcon aria-hidden="true" />
            {t('common.edit')}
          </Button>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-4">
            {details.map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-words font-semibold">
                  {value || t('credentialDefinitions.review.emptyValue')}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card className="w-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="font-bold">
            {t('credentialDefinitions.review.attributes')}
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-link hover:text-link-hover"
            aria-label={t('credentialDefinitions.review.editAttributes')}
            onClick={onEditAttributes}
          >
            <EditIcon aria-hidden="true" />
            {t('common.edit')}
          </Button>
        </CardHeader>
        <CardContent>
          {attributes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('credentialDefinitions.review.noAttributes')}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {attributes.map((attribute) => (
                <li key={attribute.id}>
                  <StatusBadge
                    label={attribute.name}
                    tone="success"
                    showCheck={false}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
