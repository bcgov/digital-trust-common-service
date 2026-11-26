import { useTranslation } from 'react-i18next';

import { StaticTag } from '@/components/common/static-tag';

const SCHEMA_LABELS = {
  properties: 'credentialDefinitionDetails.attributes',
  attributes: 'credentialDefinitionDetails.attributes',
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

function SchemaValue({
  value,
  attributes = false,
}: {
  value: unknown;
  attributes?: boolean;
}) {
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
        {entries.map(([key, item]) => {
          const record =
            item !== null && typeof item === 'object' && !Array.isArray(item)
              ? (item as Record<string, unknown>)
              : undefined;
          const attributeType = attributes
            ? typeof item === 'string'
              ? item
              : record?.type
            : undefined;
          const types =
            typeof attributeType === 'string'
              ? [attributeType]
              : Array.isArray(attributeType) &&
                  attributeType.length > 0 &&
                  attributeType.every(
                    (type): type is string => typeof type === 'string',
                  )
                ? attributeType
                : [];
          const remainder =
            types.length > 0 && record
              ? Object.fromEntries(
                  Object.entries(record).filter(([name]) => name !== 'type'),
                )
              : undefined;
          const showValue =
            types.length === 0 ||
            (remainder && Object.keys(remainder).length > 0);

          return (
            <div
              key={key}
              className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0"
            >
              <dt className="flex flex-wrap items-center gap-2 text-small-body font-bold text-(--typography-color-primary) [overflow-wrap:anywhere] [&_.static-tag]:h-auto [&_.static-tag]:max-w-full [&_.bcds-react-aria-Tag--Label]:whitespace-normal [&_.bcds-react-aria-Tag--Label]:[overflow-wrap:anywhere]">
                {types.length > 0 ? (
                  <span>{key}</span>
                ) : Object.hasOwn(SCHEMA_LABELS, key) ? (
                  t(SCHEMA_LABELS[key as keyof typeof SCHEMA_LABELS])
                ) : (
                  key
                )}
                {types.map((type, index) => (
                  <StaticTag key={index} label={type} color="grey" />
                ))}
              </dt>
              {showValue && (
                <dd className="min-w-0 pl-3 text-small-body text-(--typography-color-secondary) [overflow-wrap:anywhere]">
                  <SchemaValue
                    value={remainder ?? item}
                    attributes={key === 'properties' || key === 'attributes'}
                  />
                </dd>
              )}
            </div>
          );
        })}
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
