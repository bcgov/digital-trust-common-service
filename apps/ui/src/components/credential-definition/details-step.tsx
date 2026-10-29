import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { SelectMenu } from '@/components/common/select-menu';
import type { Connector } from '@/lib/api/resources/connectors';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';
import { useTranslation } from 'react-i18next';

const FORMAT_KEYS = {
  anoncreds: 'credentialDefinitions.setup.anoncreds',
  'sd-jwt': 'credentialDefinitions.formats.sdJwt',
  mdl: 'credentialDefinitions.formats.mdl',
  'w3c-vc': 'credentialDefinitions.formats.w3cVc',
} as const;

export function DetailsStep({
  name,
  onNameChange,
  version,
  versionInvalid,
  onVersionChange,
  description,
  onDescriptionChange,
  connectors,
  format,
  connectorId,
  defaultConnectorId,
  onConnectorChange,
}: {
  name: string;
  onNameChange: (value: string) => void;
  version: string;
  versionInvalid: boolean;
  onVersionChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  connectors: readonly Connector[];
  format: NonNullable<CredentialDefinition['format']>;
  connectorId: string;
  defaultConnectorId: string | undefined;
  onConnectorChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 px-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {t('credentialDefinitions.setup.identity')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('credentialDefinitions.setup.subtitle')}
          </p>
        </div>
        <h3 className="text-base font-semibold">
          {t('credentialDefinitions.setup.credentialIdentity')}
        </h3>
        <div className="flex gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Label htmlFor="credential-name">
              {t('credentialDefinitions.setup.name')}
            </Label>
            <Input
              id="credential-name"
              name="name"
              required
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={t('credentialDefinitions.setup.namePlaceholder')}
            />
          </div>
          <div className="flex w-1/6 min-w-24 flex-col gap-2">
            <Label htmlFor="credential-version">
              {t('credentialDefinitions.setup.version')}
            </Label>
            <Input
              id="credential-version"
              name="version"
              required
              aria-invalid={versionInvalid}
              aria-describedby={
                versionInvalid ? 'credential-version-error' : undefined
              }
              value={version}
              onChange={(event) => onVersionChange(event.target.value)}
              placeholder={t('credentialDefinitions.setup.versionPlaceholder')}
            />
            {versionInvalid && (
              <p
                id="credential-version-error"
                className="text-xs text-destructive"
              >
                {t('credentialDefinitions.setup.versionInvalid')}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="credential-description">
            {t('credentialDefinitions.setup.description')}
          </Label>
          <Input
            id="credential-description"
            name="description"
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder={t(
              'credentialDefinitions.setup.descriptionPlaceholder',
            )}
          />
        </div>
      </section>
      <section className="flex flex-col gap-4 px-6">
        <h3 className="text-base font-semibold">
          {t('credentialDefinitions.setup.chooseConnector')}
        </h3>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {t('credentialDefinitions.setup.connectorDescription')}
          </p>
          <SelectMenu
            id="credential-connector"
            aria-label={t('credentialDefinitions.setup.connector')}
            options={connectors.map((connector) => ({
              value: connector.id ?? '',
              label:
                connector.id === defaultConnectorId
                  ? t('credentialDefinitions.setup.defaultConnector', {
                      type: connector.connector_type,
                      default: t('common.default'),
                    })
                  : (connector.connector_type ?? ''),
              description: connector.endpoint_url,
            }))}
            value={connectorId}
            onValueChange={onConnectorChange}
            placeholder={t('credentialDefinitions.setup.noActiveConnectors')}
          />
        </div>
      </section>
      <section className="flex flex-col gap-4 px-6">
        <h3 className="text-base font-semibold">
          {t('credentialDefinitions.setup.format')}
        </h3>
        <div className="flex w-1/2 items-start gap-3 rounded-lg border-2 border-input bg-card p-4 has-[:checked]:border-primary">
          <input
            id={`format-${format}`}
            type="radio"
            name="format"
            value={format}
            checked
            readOnly
            aria-describedby={`format-${format}-description`}
            className="mt-0.5 size-4 accent-primary"
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`format-${format}`} className="text-base">
              {t(FORMAT_KEYS[format])}
            </Label>
            <p
              id={`format-${format}-description`}
              className="text-sm text-muted-foreground"
            >
              {format === 'anoncreds'
                ? t('credentialDefinitions.setup.anoncredsDescription')
                : t('credentialDefinitions.setup.formatLocked')}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
