import { useTranslation } from 'react-i18next';

import { StaticTag } from '@/components/common/static-tag';

const SCHEMA_LABELS = {
  attr_names: 'credentialDefinitionDetails.attributes',
  schema_name: 'credentialDefinitionDetails.schemaName',
  schema_version: 'credentialDefinitionDetails.schemaVersion',
} as const;

function scalarText(value: unknown): string | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return undefined;
}

function SchemaValue({ value }: { value: unknown }) {
  const { t } = useTranslation();

  if (Array.isArray(value)) {
    if (value.length === 0) return <p>{t('common.notAvailable')}</p>;

    const scalarItems = value.every(
      (item: unknown) => item === null || typeof item !== 'object',
    );
    return (
      <ul
        className={
          scalarItems
            ? 'flex min-w-0 flex-wrap gap-2'
            : 'flex min-w-0 flex-col gap-4'
        }
      >
        {value.map((item: unknown, index) => (
          <li
            key={index}
            className="min-w-0 max-w-full [&_.static-tag]:h-auto [&_.static-tag]:max-w-full [&_.bcds-react-aria-Tag--Label]:whitespace-normal [&_.bcds-react-aria-Tag--Label]:[overflow-wrap:anywhere]"
          >
            {scalarItems ? (
              <StaticTag
                label={scalarText(item) ?? t('common.notAvailable')}
                color="grey"
              />
            ) : (
              <SchemaValue value={item} />
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <p>{t('common.notAvailable')}</p>;

    return (
      <dl className="min-w-0 divide-y divide-(--surface-color-border-default)">
        {entries.map(([key, item]) => (
          <div
            key={key}
            className="grid min-w-0 gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-6"
          >
            <dt className="text-small-body font-bold [overflow-wrap:anywhere]">
              {key in SCHEMA_LABELS
                ? t(SCHEMA_LABELS[key as keyof typeof SCHEMA_LABELS])
                : key}
            </dt>
            <dd className="min-w-0 text-small-body [overflow-wrap:anywhere]">
              <SchemaValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span>{scalarText(value) || t('common.notAvailable')}</span>;
}

export function CredentialDefinitionSchema({
  schema,
}: {
  schema: Record<string, unknown> | undefined;
}) {
  const { t } = useTranslation();

  if (!schema || Object.keys(schema).length === 0) {
    return (
      <p className="text-small-body text-(--typography-color-secondary)">
        {t('credentialDefinitionDetails.emptySchema')}
      </p>
    );
  }

  return <SchemaValue value={schema} />;
}
