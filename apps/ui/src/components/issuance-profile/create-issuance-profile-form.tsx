import {
  Button,
  CheckboxGroup,
  Form,
  Select,
  TextField,
} from '@bcgov/design-system-react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import valid from 'semver/functions/valid';

import { BackLink } from '@/components/common/back-link';
import { MutationError } from '@/components/common/form-dialog';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  EditIcon,
} from '@/components/common/icons';
import { notify } from '@/components/common/sonner';
import { WizardSteps } from '@/components/common/wizard-steps';
import { ApiError } from '@/lib/api/errors';
import {
  useCreateIssuanceProfile,
  usePublishIssuanceProfile,
} from '@/lib/api/queries/issuance-profiles';
import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';
import type { IssuanceProfile } from '@/lib/api/resources/issuance-profiles';

import { ClaimValueRuleEditor } from './claim-value-rule-editor';
import {
  claimValueType,
  validateValueRule,
  type ClaimValueRule,
  type ClaimValueType,
} from './claim-value-rules';
import { eligibleDefinitions } from './eligible-definitions';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function definitionClaims(definition: CredentialDefinition) {
  const schema = definition.schema_definition ?? {};
  const claimsSchema = isRecord(schema.claims) ? schema.claims : schema;
  const properties = isRecord(claimsSchema.properties)
    ? claimsSchema.properties
    : isRecord(schema.attributes)
      ? schema.attributes
      : undefined;
  const names = properties
    ? Object.keys(properties)
    : Array.isArray(schema.attr_names)
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
    types: new Map<string, ClaimValueType>(
      names.map((name) => [
        name,
        properties ? claimValueType(properties[name]) : 'string',
      ]),
    ),
  };
}

export function CreateIssuanceProfileForm({
  tenantId,
  definitions,
  onCreated,
  onClose,
  embedded = false,
}: CreateIssuanceProfileFormProps) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [requiredClaims, setRequiredClaims] = useState<string[]>([]);
  const [valueRules, setValueRules] = useState<Map<string, ClaimValueRule>>(
    () => new Map(),
  );
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
  const claims: {
    names: string[];
    mandatory: string[];
    types: Map<string, ClaimValueType>;
  } = selectedDefinition
    ? definitionClaims(selectedDefinition)
    : { names: [], mandatory: [], types: new Map() };
  const selectedClaims = claims.names.filter(
    (name) => claims.mandatory.includes(name) || requiredClaims.includes(name),
  );
  const optionalClaims = claims.names.filter(
    (name) => !selectedClaims.includes(name),
  );
  const isVersionValid =
    version.trim().length <= 20 &&
    [version.trim(), `${version.trim()}.0`, `${version.trim()}.0.0`].some(
      (candidate) => valid(candidate) !== null,
    );
  const isDetailsValid =
    name.trim().length > 0 &&
    name.trim().length <= 100 &&
    isVersionValid &&
    eligible.some((definition) => definition.id === definitionId);
  const evaluatedRules = claims.names.flatMap((name) => {
    const rule = valueRules.get(name);
    if (!rule) return [];
    return [
      {
        name,
        rule,
        validation: validateValueRule(rule, claims.types.get(name) ?? 'json'),
      },
    ];
  });
  const areRulesValid = evaluatedRules.every(
    ({ validation }) => validation.valid,
  );
  const isValid = isDetailsValid && areRulesValid;
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;

  const close = () => {
    if (isPending) return;
    setName('');
    setVersion('');
    setDefinitionId('');
    setRequiredClaims([]);
    setValueRules(new Map());
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
    const properties = Object.fromEntries(
      evaluatedRules.flatMap(({ name, rule, validation }) =>
        validation.valid
          ? [
              [
                name,
                rule.mode === 'enum'
                  ? { enum: validation.values }
                  : { const: validation.values[0] },
              ],
            ]
          : [],
      ),
    );
    mutation.mutate(
      {
        name: name.trim(),
        version: version.trim(),
        credential_definition_id: definitionId,
        ...((selectedClaims.length > 0 || evaluatedRules.length > 0) && {
          claims: {
            ...(selectedClaims.length > 0 && { required: selectedClaims }),
            ...(evaluatedRules.length > 0 && { properties }),
          },
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

  const fields = (
    <div className="flex flex-col gap-4">
      <h2 className="text-h3 font-bold">
        {t('issuanceProfiles.wizard.details')}
      </h2>
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
            setValueRules(new Map());
            mutation.reset();
          }
        }}
      />
    </div>
  );
  const claimFields = (
    <>
      {selectedDefinition && (
        <div className="flex flex-col gap-2">
          <h2 className="text-h3 font-bold">
            {t('issuanceProfiles.wizard.claims')}
          </h2>
          <p>{t('issuanceProfiles.create.claimsHelp')}</p>
          {claims.names.length > 0 ? (
            <CheckboxGroup
              aria-label={t('issuanceProfiles.wizard.claims')}
              value={selectedClaims}
              onChange={setRequiredClaims}
            >
              <p>{t('issuanceProfiles.valueRules.description')}</p>
              {claims.names.map((name) => (
                <ClaimValueRuleEditor
                  key={name}
                  name={name}
                  type={claims.types.get(name) ?? 'json'}
                  rule={valueRules.get(name)}
                  isDisabled={fieldsDisabled}
                  isRequiredByDefinition={claims.mandatory.includes(name)}
                  onChange={(rule) => {
                    setValueRules((previous) => {
                      const next = new Map(previous);
                      if (rule) next.set(name, rule);
                      else next.delete(name);
                      return next;
                    });
                    mutation.reset();
                  }}
                />
              ))}
            </CheckboxGroup>
          ) : (
            <p>{t('issuanceProfiles.create.noClaims')}</p>
          )}
        </div>
      )}
    </>
  );

  return (
    <Form
      className="flex w-full flex-col gap-5"
      aria-label={t('issuanceProfiles.create.title')}
      aria-busy={isPending}
      onSubmit={(event) => event.preventDefault()}
    >
      {!embedded && (
        <div className="flex flex-col gap-2">
          <BackLink to="/issuance-profiles" isDisabled={isPending}>
            {t('issuanceProfiles.wizard.backToList')}
          </BackLink>
          <h1 className="text-h1 font-bold text-black">
            {t('issuanceProfiles.create.title')}
          </h1>
        </div>
      )}
      <WizardSteps
        steps={[
          t('issuanceProfiles.wizard.details'),
          t('issuanceProfiles.wizard.claims'),
          t('issuanceProfiles.wizard.review'),
        ]}
        currentStep={step}
        label={t('issuanceProfiles.wizard.progress')}
      />
      <MutationError
        error={mutation.error ?? publish.error}
        conflict={t('issuanceProfiles.create.duplicate')}
      />
      {createdDraft && !isPending && (
        <p role="status">
          {t(
            createdDraft.id
              ? 'issuanceProfiles.create.publishFailed'
              : 'issuanceProfiles.create.missingId',
          )}
        </p>
      )}
      {eligible.length === 0 && (
        <p role="status">{t('issuanceProfiles.create.noDefinitions')}</p>
      )}
      <div hidden={step !== 0}>{fields}</div>
      <div hidden={step !== 1}>{claimFields}</div>
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-h3 font-bold">
            {t('issuanceProfiles.wizard.review')}
          </h2>
          <section className="flex flex-col gap-medium rounded-(--layout-border-radius-large) border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-medium">
            <div className="flex items-center justify-between">
              <h3 className="text-h5 font-bold">
                {t('issuanceProfiles.wizard.details')}
              </h3>
              <Button
                variant="tertiary"
                size="small"
                isDisabled={fieldsDisabled}
                aria-label={t('issuanceProfiles.wizard.editDetails')}
                onPress={() => setStep(0)}
              >
                <EditIcon className="size-4" />
                {t('common.edit')}
              </Button>
            </div>
            <dl className="grid gap-medium text-small-body sm:grid-cols-2">
              {[
                [t('credentialDefinitions.table.name'), name.trim()],
                [t('credentialDefinitions.table.version'), version.trim()],
                [
                  t('issuanceProfiles.definition'),
                  selectedDefinition?.name && selectedDefinition.version
                    ? `${selectedDefinition.name} (${selectedDefinition.version})`
                    : (selectedDefinition?.name ?? ''),
                ],
                [
                  t('issuanceProfiles.protocol'),
                  t(`issuanceProfiles.protocols.${protocol}`),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-(--typography-color-secondary)">
                    {label}
                  </dt>
                  <dd className="break-words font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="flex flex-col gap-medium rounded-(--layout-border-radius-large) border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-medium">
            <div className="flex items-center justify-between">
              <h3 className="text-h5 font-bold">
                {t('issuanceProfiles.wizard.claims')}
              </h3>
              <Button
                variant="tertiary"
                size="small"
                isDisabled={fieldsDisabled}
                aria-label={t('issuanceProfiles.wizard.editClaims')}
                onPress={() => setStep(1)}
              >
                <EditIcon className="size-4" />
                {t('common.edit')}
              </Button>
            </div>
            <p>
              {t('issuanceProfiles.create.requiredClaims')}:{' '}
              {selectedClaims.length
                ? new Intl.ListFormat(i18n.language).format(selectedClaims)
                : t('issuanceProfiles.wizard.none')}
            </p>
            <p>
              {t('issuanceProfiles.wizard.optionalClaims')}:{' '}
              {optionalClaims.length
                ? new Intl.ListFormat(i18n.language).format(optionalClaims)
                : t('issuanceProfiles.wizard.none')}
            </p>
            <div>
              <p>{t('issuanceProfiles.valueRules.title')}</p>
              {evaluatedRules.length === 0 ? (
                <p>{t('issuanceProfiles.wizard.none')}</p>
              ) : (
                <ul>
                  {evaluatedRules.map(({ name, rule, validation }) => (
                    <li key={name} className="break-words">
                      <strong>{name}</strong>
                      {' - '}
                      {t(
                        `issuanceProfiles.valueRules.modes.${rule.mode}`,
                      )}:{' '}
                      {validation.valid &&
                        new Intl.ListFormat(i18n.language).format(
                          validation.values.map((value) =>
                            JSON.stringify(value),
                          ),
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
      {isPending && <p role="status">{t('common.saving')}</p>}
      {step === 0 && !areRulesValid && (
        <p
          role="status"
          className="text-small-body text-(--typography-color-danger)"
        >
          {t('issuanceProfiles.valueRules.fixClaims')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--surface-color-border-default) pt-4">
        <div className="flex gap-3">
          {step > 0 && !createdDraft && (
            <Button
              type="button"
              variant="secondary"
              isDisabled={isPending}
              onPress={() => setStep(step - 1)}
            >
              <ArrowLeftIcon className="size-5" />
              {t('credentialDefinitions.wizard.previous')}
            </Button>
          )}
          {!embedded && (
            <Button
              type="button"
              variant="secondary"
              isDisabled={isPending}
              onPress={close}
            >
              {t(createdDraft ? 'common.close' : 'common.cancel')}
            </Button>
          )}
        </div>
        <div className="flex gap-3">
          {!embedded && !createdDraft && (
            <Button
              type="button"
              variant="secondary"
              isDisabled={!isValid || isPending}
              onPress={() => create(false)}
            >
              {t('issuanceProfiles.create.save')}
            </Button>
          )}
          {step < 2 ? (
            <Button
              type="button"
              isDisabled={
                !isDetailsValid || (step === 1 && !areRulesValid) || isPending
              }
              onPress={() => setStep(step + 1)}
            >
              {t(
                step === 0
                  ? 'issuanceProfiles.wizard.nextClaims'
                  : 'issuanceProfiles.wizard.nextReview',
              )}
              <ArrowRightIcon className="size-5" />
            </Button>
          ) : (
            <Button
              type="button"
              isDisabled={
                isPending || (createdDraft ? !createdDraft.id : !isValid)
              }
              onPress={() => {
                if (createdDraft?.id) publishDraft(createdDraft.id);
                else create(!embedded);
              }}
            >
              {t(
                createdDraft
                  ? 'issuanceProfiles.create.retryPublish'
                  : 'issuanceProfiles.create.title',
              )}
            </Button>
          )}
        </div>
      </div>
    </Form>
  );
}
