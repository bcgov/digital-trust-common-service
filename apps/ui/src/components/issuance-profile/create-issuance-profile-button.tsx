import {
  Button,
  Select,
  TextField,
} from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import valid from 'semver/functions/valid';

import { FormActions, FormDialog } from '@/components/common/form-dialog';
import { PlusIcon } from '@/components/common/icons';
import { notify } from '@/components/common/sonner';
import { ApiError } from '@/lib/api/errors';
import { useCreateIssuanceProfile } from '@/lib/api/queries/issuance-profiles';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';

const PROTOCOLS = ['auto', 'didcomm'] as const;
const FORMAT_KEYS = {
  anoncreds: 'credentialDefinitions.setup.anoncreds',
  'sd-jwt': 'credentialDefinitions.formats.sdJwt',
  mdl: 'credentialDefinitions.formats.mdl',
  'w3c-vc': 'credentialDefinitions.formats.w3cVc',
} as const;

export function CreateIssuanceProfileButton({
  tenantId,
  definitions,
}: {
  tenantId: string;
  definitions: readonly CredentialDefinition[];
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [protocol, setProtocol] = useState<(typeof PROTOCOLS)[number]>('auto');
  const mutation = useCreateIssuanceProfile(tenantId);
  const eligibleDefinitions = definitions.filter(
    (definition) =>
      definition.id &&
      definition.status === 'published' &&
      definition.registration_state === 'ready' &&
      definition.external_id &&
      definition.connector_id,
  );
  const isVersionValid =
    version.trim().length <= 20 &&
    [version.trim(), `${version.trim()}.0`, `${version.trim()}.0.0`].some(
      (candidate) => valid(candidate) !== null,
    );
  const isValid =
    name.trim().length > 0 &&
    name.trim().length <= 100 &&
    isVersionValid &&
    eligibleDefinitions.some((definition) => definition.id === definitionId);
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const close = () => {
    if (mutation.isPending) return;
    setIsOpen(false);
    setName('');
    setVersion('');
    setDefinitionId('');
    setProtocol('auto');
    mutation.reset();
  };

  return (
    <>
      <Button
        isDisabled={eligibleDefinitions.length === 0}
        onPress={() => setIsOpen(true)}
      >
        <PlusIcon className="size-5" />
        {t('issuanceProfiles.create.title')}
      </Button>
      {eligibleDefinitions.length === 0 && (
        <p role="status">{t('issuanceProfiles.create.noDefinitions')}</p>
      )}
      {isOpen && (
        <FormDialog
          label={t('issuanceProfiles.create.title')}
          error={conflict ? undefined : mutation.error}
          isLoading={mutation.isPending}
          onClose={close}
          onSubmit={(event) => {
            event.preventDefault();
            if (!isValid || mutation.isPending) return;
            mutation.mutate(
              {
                name: name.trim(),
                version: version.trim(),
                credential_definition_id: definitionId,
                protocol_hint: protocol,
                attribute_schema: {},
              },
              {
                onSuccess: () => {
                  notify.success(t('issuanceProfiles.create.saved'));
                  setIsOpen(false);
                  setName('');
                  setVersion('');
                  setDefinitionId('');
                  setProtocol('auto');
                },
              },
            );
          }}
          actions={
            <FormActions
              submitLabel={t('issuanceProfiles.create.save')}
              isDisabled={!isValid}
              isPending={mutation.isPending}
              onClose={close}
            />
          }
        >
          <TextField
            label={t('credentialDefinitions.table.name')}
            isDisabled={mutation.isPending}
            name="name"
            isRequired
            value={name}
            onChange={(value) => {
              setName(value);
              mutation.reset();
            }}
            isInvalid={conflict || name.trim().length > 100}
            errorMessage={t(
              conflict
                ? 'issuanceProfiles.create.duplicate'
                : 'issuanceProfiles.create.nameInvalid',
            )}
          />
          <TextField
            label={t('credentialDefinitions.table.version')}
            isDisabled={mutation.isPending}
            name="version"
            isRequired
            value={version}
            onChange={(value) => {
              setVersion(value);
              mutation.reset();
            }}
            isInvalid={conflict || (Boolean(version.trim()) && !isVersionValid)}
            errorMessage={t(
              conflict
                ? 'issuanceProfiles.create.duplicate'
                : 'issuanceProfiles.create.versionInvalid',
            )}
          />
          <Select
            aria-label={t('issuanceProfiles.protocol')}
            isDisabled={mutation.isPending}
            label={t('issuanceProfiles.protocol')}
            selectedKey={protocol}
            items={PROTOCOLS.map((value) => ({
              id: value,
              label: t(`issuanceProfiles.protocols.${value}`),
            }))}
            onSelectionChange={(key) => {
              const selected = PROTOCOLS.find((value) => value === key);
              if (selected) setProtocol(selected);
            }}
          />
          <Select
            aria-label={t('issuanceProfiles.definition')}
            isDisabled={mutation.isPending}
            label={t('issuanceProfiles.definition')}
            placeholder={t('issuanceProfiles.create.chooseDefinition')}
            selectedKey={definitionId || null}
            items={eligibleDefinitions.map((definition) => ({
              id: definition.id ?? '',
              label: `${definition.name} (${definition.version})`,
              description: definition.format
                ? t(FORMAT_KEYS[definition.format])
                : t('issuanceProfiles.unavailable'),
            }))}
            onSelectionChange={(key) => {
              if (typeof key === 'string') setDefinitionId(key);
            }}
          />
        </FormDialog>
      )}
    </>
  );
}
