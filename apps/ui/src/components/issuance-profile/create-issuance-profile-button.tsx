import {
  Button,
  Checkbox,
  CheckboxGroup,
  Form,
  Select,
  TextField,
} from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import valid from 'semver/functions/valid';

import { FormDialog, MutationError } from '@/components/common/form-dialog';
import { PlusIcon } from '@/components/common/icons';
import { notify } from '@/components/common/sonner';
import { ApiError } from '@/lib/api/errors';
import {
  useCreateIssuanceProfile,
  usePublishIssuanceProfile,
} from '@/lib/api/queries/issuance-profiles';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function definitionClaims(definition: CredentialDefinition) {
  const schema = definition.schema_definition ?? {};
  const claimsSchema =
    definition.format !== 'anoncreds' && isRecord(schema.claims)
      ? schema.claims
      : schema;
  const properties = isRecord(claimsSchema.properties)
    ? claimsSchema.properties
    : definition.format === 'anoncreds' && isRecord(schema.attributes)
      ? schema.attributes
      : undefined;
  const names = properties
    ? Object.keys(properties)
    : definition.format === 'anoncreds' && Array.isArray(schema.attr_names)
      ? [
          ...new Set(
            schema.attr_names.filter(
              (name): name is string => typeof name === 'string',
            ),
          ),
        ]
      : [];
  const mandatory = [schema.required, claimsSchema.required].flatMap((value) =>
    Array.isArray(value)
      ? value.filter((name): name is string => typeof name === 'string')
      : [],
  );
  return {
    names,
    mandatory: names.filter((name) => mandatory.includes(name)),
  };
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
  const [requiredClaims, setRequiredClaims] = useState<string[]>([]);
  const [protocol, setProtocol] =
    useState<(typeof PROTOCOLS)[number]>('didcomm-v1');
  const [createdDraft, setCreatedDraft] = useState<IssuanceProfile | null>(
    null,
  );
  const mutation = useCreateIssuanceProfile(tenantId);
  const publish = usePublishIssuanceProfile(tenantId);
  const isPending = mutation.isPending || publish.isPending;
  const fieldsDisabled = isPending || createdDraft !== null;
  const eligible = eligibleDefinitions(definitions);
  const selectedDefinition = eligible.find(
    (definition) => definition.id === definitionId,
  );
  const claims = selectedDefinition
    ? definitionClaims(selectedDefinition)
    : { names: [], mandatory: [] };
  const selectedClaims = claims.names.filter(
    (name) => claims.mandatory.includes(name) || requiredClaims.includes(name),
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
    eligible.some((definition) => definition.id === definitionId);
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const error = conflict ? undefined : mutation.error;

  const close = () => {
    if (isPending) return;
    setName('');
    setVersion('');
    setDefinitionId('');
    setRequiredClaims([]);
    setProtocol('didcomm-v1');
    mutation.reset();
    publish.reset();
    setCreatedDraft(null);
    onClose();
  };

  const publishDraft = (profileId: string) => {
    publish.mutate(profileId, {
      onSuccess: (published) => {
        notify.success(t('issuanceProfiles.publish.saved'));
        onCreated?.(published);
      },
    });
  };

  const create = (publishImmediately: boolean) => {
    if (!isValid || isPending || createdDraft) return;
    mutation.mutate(
      {
        name: name.trim(),
        version: version.trim(),
        credential_definition_id: definitionId,
        ...(selectedClaims.length > 0 && {
          claims: { required: selectedClaims },
        }),
        delivery: { protocol },
      },
      {
        onSuccess: (profile) => {
          if (publishImmediately) {
            setCreatedDraft(profile);
            if (profile.id) publishDraft(profile.id);
          } else {
            notify.success(t('issuanceProfiles.create.saved'));
            onCreated?.(profile);
          }
        },
      },
    );
  };

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    create(false);
  };

  const fields = (
    <>
      <TextField
        label={t('credentialDefinitions.table.name')}
        isDisabled={fieldsDisabled}
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
        isDisabled={fieldsDisabled}
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
        isDisabled={fieldsDisabled}
        label={t('issuanceProfiles.protocol')}
        value={protocol}
        items={PROTOCOLS.map((value) => ({
          id: value,
          label: t(`issuanceProfiles.protocols.${value}`),
        }))}
        onChange={(key) => {
          const selected = PROTOCOLS.find((value) => value === key);
          if (selected) setProtocol(selected);
        }}
      />
      <Select
        aria-label={t('issuanceProfiles.definition')}
        isDisabled={fieldsDisabled}
        label={t('issuanceProfiles.definition')}
        placeholder={t('issuanceProfiles.create.chooseDefinition')}
        value={definitionId || null}
        items={eligible.map((definition) => ({
          id: definition.id ?? '',
          label: `${definition.name} (${definition.version})`,
          description: definition.format
            ? t(FORMAT_KEYS[definition.format])
            : t('issuanceProfiles.unavailable'),
        }))}
        onChange={(key) => {
          if (typeof key === 'string' && key !== definitionId) {
            setDefinitionId(key);
            setRequiredClaims([]);
          }
        }}
      />
      {selectedDefinition && (
        <div className="flex flex-col gap-2">
          <p>{t('issuanceProfiles.create.claimsHelp')}</p>
          {claims.names.length > 0 ? (
            <CheckboxGroup
              label={t('issuanceProfiles.create.requiredClaims')}
              value={selectedClaims}
              onChange={setRequiredClaims}
            >
              {claims.names.map((name) => (
                <Checkbox
                  key={name}
                  value={name}
                  isDisabled={fieldsDisabled || claims.mandatory.includes(name)}
                >
                  {name}
                </Checkbox>
              ))}
            </CheckboxGroup>
          ) : (
            <p>{t('issuanceProfiles.create.noClaims')}</p>
          )}
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <Form
        className="flex w-full flex-col gap-4"
        onSubmit={submit}
        aria-busy={isPending}
      >
        <MutationError error={error} />
        {eligible.length === 0 && (
          <p role="status">{t('issuanceProfiles.create.noDefinitions')}</p>
        )}
        {fields}
        {isPending && <p role="status">{t('common.saving')}</p>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-(--surface-color-border-default) pt-4">
          <Button type="submit" isDisabled={!isValid || isPending}>
            {t('issuanceProfiles.create.title')}
          </Button>
        </div>
      </Form>
    );
  }

  return (
    <FormDialog
      label={t('issuanceProfiles.create.title')}
      error={error ?? publish.error}
      intro={
        createdDraft && !isPending
          ? t(
              createdDraft.id
                ? 'issuanceProfiles.create.publishFailed'
                : 'issuanceProfiles.create.missingId',
            )
          : undefined
      }
      isLoading={isPending}
      onClose={close}
      onSubmit={submit}
      actions={
        <>
          <Button variant="secondary" isDisabled={isPending} onPress={close}>
            {t(createdDraft ? 'common.close' : 'common.cancel')}
          </Button>
          {!createdDraft && (
            <Button
              variant="secondary"
              type="submit"
              isDisabled={!isValid || isPending}
            >
              {t('issuanceProfiles.create.save')}
            </Button>
          )}
          <Button
            type="button"
            isDisabled={
              isPending || (createdDraft ? !createdDraft.id : !isValid)
            }
            onPress={() => {
              if (createdDraft?.id && !isPending) publishDraft(createdDraft.id);
              else create(true);
            }}
          >
            {t(
              createdDraft
                ? 'issuanceProfiles.create.retryPublish'
                : 'issuanceProfiles.create.title',
            )}
          </Button>
        </>
      }
    >
      {fields}
    </FormDialog>
  );
}
