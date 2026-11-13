import { Button } from '@bcgov/design-system-react-components';
import { startTransition, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import valid from 'semver/functions/valid';

import { AccessDenied } from '@/components/common/access-denied';
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/common/icons';
import { LoadingMessage } from '@/components/common/query-status';
import { notify } from '@/components/common/sonner';
import {
  AttributesStep,
  type Attribute,
} from '@/components/credential-definition/attributes-step';
import { ReviewStep } from '@/components/credential-definition/review-step';
import { DetailsStep } from '@/components/credential-definition/details-step';
import { WizardSteps } from '@/components/credential-definition/wizard-steps';
import { ApiError } from '@/lib/api/errors';
import { useConnectors } from '@/lib/api/queries/connectors';
import {
  useCreateCredentialDefinition,
  useCredentialDefinition,
  useRegisterCredentialDefinition,
  useUpdateCredentialDefinition,
} from '@/lib/api/queries/credential-definitions';
import { useTenant } from '@/lib/api/queries/tenants';
import { useAuth } from '@/lib/auth/context';
import { hasScope, TENANT_ADMIN_SCOPE } from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

type SemanticAttributeType = Attribute['type'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function semanticType(value: unknown): SemanticAttributeType {
  const type = isRecord(value) ? value.type : value;
  return type === 'integer' || type === 'number' || type === 'boolean'
    ? type
    : 'string';
}

export function CreateOrEditCredentialDefinitionPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tenant } = useActiveTenant();
  const canManage = hasScope(user, TENANT_ADMIN_SCOPE);
  const connectorsQuery = useConnectors(tenant?.id, { enabled: canManage });
  const tenantQuery = useTenant(tenant?.id, { enabled: canManage });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('id');
  const draftQuery = useCredentialDefinition(tenant?.id, draftId, {
    enabled: canManage,
  });
  const createMutation = useCreateCredentialDefinition(tenant?.id);
  const registerMutation = useRegisterCredentialDefinition(tenant?.id);
  const updateMutation = useUpdateCredentialDefinition(tenant?.id);
  const steps = [
    t('credentialDefinitions.wizard.steps.details'),
    t('credentialDefinitions.wizard.steps.attributes'),
    t('credentialDefinitions.wizard.steps.review'),
  ];
  const attributeIdPrefix = useId();
  const [step, setStep] = useState(0);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [attributes, setAttributes] = useState<Attribute[]>(() => [
    { id: `${attributeIdPrefix}-initial`, name: '', type: 'string' },
  ]);
  const [chosenConnectorId, setChosenConnectorId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    const definition = draftQuery.data;
    if (!canManage || !draftId || !definition || loadedDraftId === draftId)
      return;
    if (definition.status !== 'draft') {
      notify.danger(t('credentialDefinitions.wizard.draftNotEditable'));
      void navigate('/credential-definitions');
      return;
    }
    if (definition.format !== 'anoncreds') {
      notify.danger(t('credentialDefinitions.wizard.unsupportedFormat'));
      void navigate('/credential-definitions');
      return;
    }

    startTransition(() => {
      const schemaDefinition = definition.schema_definition ?? {};
      const attributeNames = schemaDefinition.attr_names;
      const propertySchemas = schemaDefinition.properties;
      const semanticTypes = schemaDefinition.attributes;
      setName(definition.name ?? '');
      setVersion(definition.version ?? '');
      setDescription(
        typeof definition.metadata?.description === 'string'
          ? definition.metadata.description
          : '',
      );
      const draftAttributes = Array.isArray(attributeNames)
        ? attributeNames
            .filter(
              (attributeName: unknown): attributeName is string =>
                typeof attributeName === 'string',
            )
            .map((attributeName, index) => ({
              id: `${draftId}-${index}`,
              name: attributeName,
              type: 'string' as const,
            }))
        : Object.entries(
            isRecord(propertySchemas)
              ? propertySchemas
              : isRecord(semanticTypes)
                ? semanticTypes
                : {},
          ).map(([attributeName, declaration], index) => ({
            id: `${draftId}-${index}`,
            name: attributeName,
            type: semanticType(declaration),
          }));
      setAttributes(
        draftAttributes.length > 0
          ? draftAttributes
          : [{ id: `${draftId}-initial`, name: '', type: 'string' }],
      );
      setChosenConnectorId(definition.connector_id ?? null);
      setLoadedDraftId(draftId);
    });
  }, [canManage, draftId, draftQuery.data, loadedDraftId, navigate, t]);

  useEffect(() => {
    if (canManage && draftQuery.isError) {
      notify.danger(t('credentialDefinitions.wizard.draftLoadFailed'));
      void navigate('/credential-definitions');
    }
  }, [canManage, draftQuery.isError, navigate, t]);
  const activeConnectors = (connectorsQuery.data?.data ?? []).filter(
    (connector) => connector.active === true,
  );
  const defaultConnectorId = tenantQuery.data?.config?.default_connector;
  const connectorId =
    chosenConnectorId ??
    activeConnectors.find((connector) => connector.id === defaultConnectorId)
      ?.id ??
    activeConnectors[0]?.id ??
    '';

  const selectedConnector = activeConnectors.find(
    (connector) => connector.id === connectorId,
  );
  const details: [string, string][] = [
    [t('credentialDefinitions.review.credentialName'), name],
    [t('credentialDefinitions.review.version'), version],
    ...(description.trim()
      ? [
          [t('credentialDefinitions.review.description'), description] as [
            string,
            string,
          ],
        ]
      : []),
    [
      t('credentialDefinitions.review.connector'),
      selectedConnector?.connector_type ?? '',
    ],
    [
      t('credentialDefinitions.review.format'),
      t('credentialDefinitions.setup.anoncreds'),
    ],
  ];
  const namedAttributes = attributes.filter((attribute) =>
    attribute.name.trim(),
  );

  const isVersionValid = [
    version.trim(),
    `${version.trim()}.0`,
    `${version.trim()}.0.0`,
  ].some((candidate) => valid(candidate) !== null);
  const isSetupValid =
    name.trim() !== '' && isVersionValid && selectedConnector?.id !== undefined;

  const canPublish = isSetupValid && namedAttributes.length > 0;

  const createDefinition = (
    status: 'draft' | 'published',
    exitAfterSave = false,
  ) => {
    if (!isSetupValid || !selectedConnector?.id) return;
    const trimmedName = name.trim();
    const trimmedVersion = version.trim();
    const schemaDefinition = {
      attributes: Object.fromEntries(
        namedAttributes.map((attribute) => [
          attribute.name.trim(),
          attribute.type,
        ]),
      ),
      schema_name: trimmedName,
      schema_version: trimmedVersion,
      version: trimmedVersion,
    };
    const metadata = { ...(draftQuery.data?.metadata ?? {}) };
    if (description.trim()) metadata.description = description.trim();
    else delete metadata.description;

    const onError = (error: Error) => {
      notify.danger(
        error instanceof ApiError
          ? error.message
          : status === 'draft'
            ? t('credentialDefinitions.wizard.couldNotSaveDraft')
            : t('credentialDefinitions.wizard.couldNotPublish'),
      );
    };

    const request = {
      name: trimmedName,
      connector_id: selectedConnector.id,
      status,
      schema: { definition: schemaDefinition },
      options:
        draftQuery.data?.options?.format === 'anoncreds'
          ? draftQuery.data.options
          : {
              format: 'anoncreds' as const,
              tag: 'default',
              status: { revocation: { enabled: true } },
            },
      ...(Object.keys(metadata).length > 0 && { metadata }),
    };
    const draftUpdate = {
      name: trimmedName,
      status: 'draft' as const,
      schema_definition: schemaDefinition,
      connector_id: selectedConnector.id,
      metadata,
    };
    const finishDraftSave = (definitionId: string | undefined) => {
      notify.success(
        t(
          draftId
            ? 'credentialDefinitions.notifications.draftUpdated'
            : 'credentialDefinitions.notifications.draftSaved',
        ),
      );
      if (exitAfterSave) {
        void navigate('/credential-definitions');
      } else if (!draftId && definitionId) {
        void navigate(
          `/credential-definitions/create-or-edit?id=${encodeURIComponent(definitionId)}`,
          { replace: true },
        );
      }
    };

    if (status === 'draft') {
      if (draftId) {
        updateMutation.mutate(
          { credentialDefinitionId: draftId, body: draftUpdate },
          {
            onSuccess: (definition) => finishDraftSave(definition.id),
            onError,
          },
        );
      } else {
        createMutation.mutate(request, {
          onSuccess: (definition) => finishDraftSave(definition.id),
          onError,
        });
      }
      return;
    }

    const register = () =>
      registerMutation.mutate(request, {
        onSuccess: () => {
          notify.success(t('credentialDefinitions.wizard.registrationStarted'));
          void navigate('/credential-definitions');
        },
        onError,
      });
    if (draftId) {
      updateMutation.mutate(
        { credentialDefinitionId: draftId, body: draftUpdate },
        { onSuccess: register, onError },
      );
    } else {
      register();
    }
  };

  const isSaving =
    createMutation.isPending ||
    registerMutation.isPending ||
    updateMutation.isPending;

  const saveDraft = () => {
    if (isSetupValid) createDefinition('draft');
  };

  const publish = () => {
    if (canPublish) createDefinition('published');
  };

  if (!canManage) {
    return (
      <AccessDenied
        title={t('credentialDefinitions.title')}
        headingLevel={1}
        description={t('credentialDefinitions.forbidden')}
      />
    );
  }

  if (draftId && (draftQuery.isLoading || loadedDraftId !== draftId)) {
    return (
      <LoadingMessage>
        {t('credentialDefinitions.wizard.loadingDraft')}
      </LoadingMessage>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          to="/credential-definitions"
          className="inline-flex w-fit items-center gap-2 text-small-body text-(--typography-color-link) hover:underline"
        >
          <ArrowLeftIcon className="size-4" />
          {t('credentialDefinitions.wizard.backToList')}
        </Link>
        <h1 className="text-h1 font-bold text-black">
          {draftId
            ? t('credentialDefinitions.wizard.editTitle')
            : t('credentialDefinitions.wizard.newTitle')}
        </h1>
      </div>
      <WizardSteps steps={steps} currentStep={step} />
      {/* Kept mounted so entered values survive moving between steps. */}
      <div hidden={step !== 0} className="flex flex-col gap-5">
        <DetailsStep
          name={name}
          onNameChange={setName}
          version={version}
          versionInvalid={Boolean(version.trim()) && !isVersionValid}
          onVersionChange={setVersion}
          description={description}
          onDescriptionChange={setDescription}
          connectors={activeConnectors}
          connectorId={connectorId}
          defaultConnectorId={
            typeof defaultConnectorId === 'string'
              ? defaultConnectorId
              : undefined
          }
          onConnectorChange={setChosenConnectorId}
        />
      </div>
      {/* Kept mounted so the attribute list survives moving between steps. */}
      <div hidden={step !== 1}>
        <AttributesStep attributes={attributes} onChange={setAttributes} />
      </div>
      {step === 2 && (
        <ReviewStep
          details={details}
          attributes={namedAttributes}
          onEditDetails={() => setStep(0)}
          onEditAttributes={() => setStep(1)}
        />
      )}
      {step === 0 && !isSetupValid && (
        <p
          role="status"
          className="px-6 text-small-body font-bold text-(--typography-color-danger)"
        >
          {t('credentialDefinitions.wizard.draftRequirements')}
        </p>
      )}
      {step === 2 && !canPublish && (
        <p
          role="status"
          className="px-6 text-small-body font-bold text-(--typography-color-danger)"
        >
          {t('credentialDefinitions.wizard.publishRequirements')}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between border-t border-(--surface-color-border-default) px-6 pt-5">
        {step === 0 ? (
          <Button
            variant="secondary"
            onPress={() => void navigate('/credential-definitions')}
          >
            {t('credentialDefinitions.wizard.cancel')}
          </Button>
        ) : (
          <div className="flex gap-3">
            <Button
              variant="secondary"
              isDisabled={isSaving}
              onPress={() => setStep(step - 1)}
            >
              <ArrowLeftIcon className="size-5" />
              {t('credentialDefinitions.wizard.previous')}
            </Button>
            <Button
              variant="secondary"
              onPress={() => void navigate('/credential-definitions')}
            >
              {t('credentialDefinitions.wizard.cancel')}
            </Button>
          </div>
        )}
        {step === 0 && (
          <div className="flex gap-3">
            <Button
              variant="secondary"
              isDisabled={!isSetupValid || isSaving}
              onPress={saveDraft}
            >
              {isSaving
                ? t('credentialDefinitions.wizard.savingDraft')
                : t('credentialDefinitions.wizard.saveDraft')}
            </Button>
            <Button
              isDisabled={!isSetupValid || isSaving}
              onPress={() => setStep(1)}
            >
              {t('credentialDefinitions.wizard.nextAttributes')}
              <ArrowRightIcon className="size-5" />
            </Button>
          </div>
        )}
        {step === 1 && (
          <div className="flex gap-3">
            <Button
              variant="secondary"
              isDisabled={!isSetupValid || isSaving}
              onPress={saveDraft}
            >
              {isSaving
                ? t('credentialDefinitions.wizard.savingDraft')
                : t('credentialDefinitions.wizard.saveDraft')}
            </Button>
            <Button
              isDisabled={!isSetupValid || isSaving}
              onPress={() => setStep(2)}
            >
              {t('credentialDefinitions.wizard.nextReview')}
              <ArrowRightIcon className="size-5" />
            </Button>
          </div>
        )}
        {step === 2 && (
          <div className="flex gap-3">
            <Button
              variant="secondary"
              isDisabled={!isSetupValid || isSaving}
              onPress={() => createDefinition('draft', true)}
            >
              {isSaving
                ? t('credentialDefinitions.wizard.savingDraft')
                : t('credentialDefinitions.wizard.saveAndExit')}
            </Button>
            <Button isDisabled={!canPublish || isSaving} onPress={publish}>
              {isSaving
                ? t('credentialDefinitions.wizard.publishing')
                : t('credentialDefinitions.wizard.publish')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
