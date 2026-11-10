import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { StaticTag } from '@/components/common/static-tag';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';

import { CredentialDefinitionSchema } from './credential-definition-schema';

const FORMAT_KEYS = {
  anoncreds: 'credentialDefinitions.setup.anoncreds',
  'sd-jwt': 'credentialDefinitions.formats.sdJwt',
  mdl: 'credentialDefinitions.formats.mdl',
  'w3c-vc': 'credentialDefinitions.formats.w3cVc',
} as const;

export function CredentialDefinitionDetails({
  definition,
}: {
  definition: CredentialDefinition;
}) {
  const { t } = useTranslation();
  const unavailable = t('common.notAvailable');
  const schema = Object.fromEntries(
    Object.entries(definition.schema_definition ?? {}).filter(
      ([key, value]) =>
        !(
          (key === 'version' || key === 'schema_version') &&
          value === definition.version
        ),
    ),
  );
  const details: [string, ReactNode][] = [
    [t('credentialDefinitions.table.name'), definition.name],
    [t('credentialDefinitions.table.version'), definition.version],
    [
      t('credentialDefinitionDetails.id'),
      definition.id ? (
        <code className="font-mono [overflow-wrap:anywhere]">
          {definition.id}
        </code>
      ) : (
        unavailable
      ),
    ],
    [
      t('credentialDefinitions.table.format'),
      definition.format ? t(FORMAT_KEYS[definition.format]) : unavailable,
    ],
    [
      t('credentialDefinitions.table.status'),
      definition.status ? (
        <StaticTag
          label={t(`credentialDefinitions.statuses.${definition.status}`)}
          color={
            definition.status === 'published'
              ? 'green'
              : definition.status === 'draft'
                ? 'yellow'
                : 'grey'
          }
        />
      ) : (
        unavailable
      ),
    ],
    [
      t('credentialDefinitions.review.description'),
      typeof definition.metadata?.description === 'string'
        ? definition.metadata.description
        : unavailable,
    ],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-large">
      <dl className="grid gap-medium sm:grid-cols-2 lg:grid-cols-3">
        {details.map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 border-b border-(--surface-color-border-default) pb-4"
          >
            <dt className="text-small-body text-(--typography-color-secondary)">
              {label}
            </dt>
            <dd className="break-words font-bold">{value || unavailable}</dd>
          </div>
        ))}
      </dl>
      <div className="flex min-w-0 flex-col gap-medium">
        <CredentialDefinitionSchema schema={schema} />
      </div>
    </div>
  );
}
