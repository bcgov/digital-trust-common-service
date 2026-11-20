import {
  Button,
  Form,
  Select,
  TextField,
} from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import valid from 'semver/functions/valid';

import {
  FormActions,
  FormDialog,
  MutationError,
} from '@/components/common/form-dialog';
import { PlusIcon } from '@/components/common/icons';
import { notify } from '@/components/common/sonner';
import { ApiError } from '@/lib/api/errors';
import { useCreateIssuanceProfile } from '@/lib/api/queries/issuance-profiles';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';
import type { IssuanceProfile } from '@/lib/api/resources/issuance-profiles';

const PROTOCOLS = ['didcomm-v1'] as const;
const FORMAT_KEYS = {
  anoncreds: 'credentialDefinitions.setup.anoncreds',
  'sd-jwt': 'credentialDefinitions.formats.sdJwt',
  mdl: 'credentialDefinitions.formats.mdl',
  'w3c-vc': 'credentialDefinitions.formats.w3cVc',
} as const;

interface CreateIssuanceProfileProps {
  tenantId: string;
  definitions: readonly CredentialDefinition[];
  onCreated?: (profile: IssuanceProfile) => void;
}

interface CreateIssuanceProfileFormProps extends CreateIssuanceProfileProps {
  onClose: () => void;
  embedded?: boolean;
}

function eligibleDefinitions(definitions: readonly CredentialDefinition[]) {
  return definitions.filter(
    (definition) =>
      definition.id &&
      definition.status === 'published' &&
      definition.registration_state === 'ready' &&
      definition.external_id &&
      definition.connector_id,
  );
}

export function CreateIssuanceProfileButton({
  tenantId,
  definitions,
  onCreated,
}: CreateIssuanceProfileProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const canCreate = eligibleDefinitions(definitions).length > 0;

  return (
    <>
      <Button isDisabled={!canCreate} onPress={() => setIsOpen(true)}>
        <PlusIcon className="size-5" />
        {t('issuanceProfiles.create.title')}
      </Button>
      {!canCreate && (
        <p role="status">{t('issuanceProfiles.create.noDefinitions')}</p>
      )}
      {isOpen && (
        <CreateIssuanceProfileForm
          tenantId={tenantId}
          definitions={definitions}
          onClose={() => setIsOpen(false)}
          onCreated={(profile) => {
            setIsOpen(false);
            onCreated?.(profile);
          }}
        />
      )}
    </>
  );
}

export function CreateIssuanceProfileForm({
  tenantId,
  definitions,
  onCreated,
  onClose,
  embedded = false,
}: CreateIssuanceProfileFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [protocol, setProtocol] =
    useState<(typeof PROTOCOLS)[number]>('didcomm-v1');
  const mutation = useCreateIssuanceProfile(tenantId);
  const eligible = eligibleDefinitions(definitions);
  const isVersionValid =
    version.trim().length <= 20 &&
    [version.trim(), `${version.trim()}.0`, `${version.trim()}.0.0`].some(
      (candidate) => valid(candidate) !== null,
    );
  const isValid =
    name.trim().length > 0 &&
    name.trim().length <= 100 &&
    isVersionValid &&
    eligible.some((definition) => definition.id === definitionId);
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const error = conflict ? undefined : mutation.error;

  const close = () => {
    if (mutation.isPending) return;
    setName('');
    setVersion('');
    setDefinitionId('');
    setProtocol('didcomm-v1');
    mutation.reset();
    onClose();
  };

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!isValid || mutation.isPending) return;
    mutation.mutate(
      {
        name: name.trim(),
        version: version.trim(),
        credential_definition_id: definitionId,
        delivery: { protocol },
      },
      {
        onSuccess: (profile) => {
          notify.success(t('issuanceProfiles.create.saved'));
          onCreated?.(profile);
        },
      },
    );
  };

  const fields = (
    <>
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
        items={eligible.map((definition) => ({
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
    </>
  );

  if (embedded) {
    return (
      <Form
        className="flex w-full flex-col gap-4"
        onSubmit={submit}
        aria-busy={mutation.isPending}
      >
        <MutationError error={error} />
        {eligible.length === 0 && (
          <p role="status">{t('issuanceProfiles.create.noDefinitions')}</p>
        )}
        {fields}
        {mutation.isPending && <p role="status">{t('common.saving')}</p>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-(--surface-color-border-default) pt-4">
          <Button
            variant="secondary"
            isDisabled={mutation.isPending}
            onPress={close}
          >
            {t('tenantOnboarding.saveForLater')}
          </Button>
          <Button type="submit" isDisabled={!isValid || mutation.isPending}>
            {t('issuanceProfiles.create.title')}
          </Button>
        </div>
      </Form>
    );
  }

  return (
    <FormDialog
      label={t('issuanceProfiles.create.title')}
      error={error}
      isLoading={mutation.isPending}
      onClose={close}
      onSubmit={submit}
      actions={
        <FormActions
          submitLabel={t('issuanceProfiles.create.save')}
          isDisabled={!isValid}
          isPending={mutation.isPending}
          onClose={close}
        />
      }
    >
      {fields}
    </FormDialog>
  );
}
