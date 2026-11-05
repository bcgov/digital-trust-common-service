import { Select, TextField } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';

import type { Connector } from '@/lib/api/resources/connectors';

export function DetailsStep({
  name,
  onNameChange,
  version,
  versionInvalid,
  onVersionChange,
  description,
  onDescriptionChange,
  connectors,
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
  connectorId: string;
  defaultConnectorId: string | undefined;
  onConnectorChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 px-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-h5 font-bold">
            {t('credentialDefinitions.setup.identity')}
          </h2>
          <p className="text-small-body text-(--typography-color-secondary)">
            {t('credentialDefinitions.setup.subtitle')}
          </p>
        </div>
        <h3 className="text-body font-bold">
          {t('credentialDefinitions.setup.credentialIdentity')}
        </h3>
        <div className="flex gap-4">
          <TextField
            className="min-w-0 flex-1"
            label={t('credentialDefinitions.setup.name')}
            name="name"
            isRequired
            value={name}
            onChange={onNameChange}
            // Untyped in BCDS 0.8.1's TextFieldProps, but forwarded by
            // react-aria's useTextField to the input at runtime.
            {...{
              placeholder: t('credentialDefinitions.setup.namePlaceholder'),
            }}
          />
          <TextField
            className="w-1/6 min-w-24"
            label={t('credentialDefinitions.setup.version')}
            name="version"
            isRequired
            isInvalid={versionInvalid}
            errorMessage={t('credentialDefinitions.setup.versionInvalid')}
            value={version}
            onChange={onVersionChange}
            {...{
              placeholder: t('credentialDefinitions.setup.versionPlaceholder'),
            }}
          />
        </div>
        <TextField
          label={t('credentialDefinitions.setup.description')}
          name="description"
          value={description}
          onChange={onDescriptionChange}
          {...{
            placeholder: t(
              'credentialDefinitions.setup.descriptionPlaceholder',
            ),
          }}
        />
      </section>
      <section className="flex flex-col gap-4 px-6">
        <h3 className="text-body font-bold">
          {t('credentialDefinitions.setup.chooseConnector')}
        </h3>
        <div className="flex flex-col gap-2">
          <p className="text-small-body text-(--typography-color-secondary)">
            {t('credentialDefinitions.setup.connectorDescription')}
          </p>
          <Select
            aria-label={t('credentialDefinitions.setup.connector')}
            items={connectors.map((connector) => ({
              id: connector.id ?? '',
              label:
                connector.id === defaultConnectorId
                  ? t('credentialDefinitions.setup.defaultConnector', {
                      type: connector.connector_type,
                      default: t('common.default'),
                    })
                  : (connector.connector_type ?? ''),
              description: connector.endpoint_url,
            }))}
            selectedKey={connectorId || null}
            onSelectionChange={(key) => {
              if (typeof key === 'string') onConnectorChange(key);
            }}
            placeholder={t('credentialDefinitions.setup.noActiveConnectors')}
          />
        </div>
      </section>
      <section className="flex flex-col gap-4 px-6">
        <h3 className="text-body font-bold">
          {t('credentialDefinitions.setup.format')}
        </h3>
        <div className="flex w-1/2 items-start gap-3 rounded-lg border-2 border-(--surface-color-border-default) bg-(--surface-color-background-white) p-4 has-[:checked]:border-(--surface-color-border-active)">
          <input
            id="format-anoncreds"
            type="radio"
            name="format"
            value="anoncreds"
            checked
            readOnly
            aria-describedby="format-anoncreds-description"
            className="mt-0.5 size-4 accent-(--surface-color-primary-default)"
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="format-anoncreds" className="text-body font-bold">
              {t('credentialDefinitions.setup.anoncreds')}
            </label>
            <p
              id="format-anoncreds-description"
              className="text-small-body text-(--typography-color-secondary)"
            >
              {t('credentialDefinitions.setup.anoncredsDescription')}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
