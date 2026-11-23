import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useCredentialDefinitionRegistrationOperation,
  useCredentialDefinitions,
} from '@/lib/api/queries/credential-definitions';
import { usePublishIssuanceProfile } from '@/lib/api/queries/issuance-profiles';
import { useTenantOnboarding } from '@/lib/api/queries/tenants';
import type { ClientCredentials } from '@/lib/api/resources/api-clients';
import type { CredentialDefinitionRegistrationOperation } from '@/lib/api/resources/credential-definitions';
import type { IssuanceProfile } from '@/lib/api/resources/issuance-profiles';

const issuanceProfileDraftKey = (tenantId: string) =>
  `tenant-onboarding:issuance-profile:${tenantId}`;

interface PendingIssuanceProfile {
  tenantId: string;
  profileId: string;
  status: 'draft' | 'published';
}

interface CredentialDefinitionRegistrationIdentity {
  tenantId: string;
  operationId: string;
  definitionId?: string;
}

function readPendingIssuanceProfile(
  tenantId: string | undefined,
): PendingIssuanceProfile | null {
  if (!tenantId) return null;
  const key = issuanceProfileDraftKey(tenantId);
  const profileId = sessionStorage.getItem(key);
  if (!profileId) return null;
  return {
    tenantId,
    profileId,
    status:
      sessionStorage.getItem(`${key}:status`) === 'published'
        ? 'published'
        : 'draft',
  };
}

export function useTenantOnboardingSetup({
  tenantId,
  canManageConnectors,
  onStepReset,
}: {
  tenantId: string | undefined;
  canManageConnectors: boolean;
  onStepReset: () => void;
}) {
  const { t } = useTranslation();
  const definitionsQuery = useCredentialDefinitions(tenantId, {
    enabled: canManageConnectors,
  });
  const hasPendingCredentialDefinition =
    definitionsQuery.data?.data.some(
      (definition) =>
        definition.status === 'published' &&
        definition.registration_state === 'pending',
    ) === true;
  const hasReadyCredentialDefinition =
    definitionsQuery.data?.data.some(
      (definition) =>
        definition.status === 'published' &&
        definition.registration_state === 'ready',
    ) === true;
  const pendingDefinition = definitionsQuery.data?.data.find(
    (definition) =>
      definition.status === 'published' &&
      definition.registration_state === 'pending',
  );
  const failedDefinition = definitionsQuery.data?.data.find(
    (definition) =>
      definition.status === 'published' &&
      definition.registration_state === 'failed',
  );
  const serverRegistrationDefinition = pendingDefinition ?? failedDefinition;
  const [
    startedCredentialDefinitionRegistration,
    setStartedCredentialDefinitionRegistration,
  ] = useState<CredentialDefinitionRegistrationIdentity | null>(null);
  const currentCredentialDefinitionRegistration =
    startedCredentialDefinitionRegistration?.tenantId === tenantId
      ? startedCredentialDefinitionRegistration
      : serverRegistrationDefinition?.registration_operation_id && tenantId
        ? {
            tenantId,
            operationId: serverRegistrationDefinition.registration_operation_id,
            ...(serverRegistrationDefinition.id && {
              definitionId: serverRegistrationDefinition.id,
            }),
          }
        : null;
  const registrationOperationQuery =
    useCredentialDefinitionRegistrationOperation(
      tenantId,
      currentCredentialDefinitionRegistration?.operationId ?? null,
    );
  const registrationFailed =
    registrationOperationQuery.data?.state === 'failed' ||
    (!pendingDefinition && failedDefinition !== undefined);
  const registrationInProgress =
    !registrationFailed &&
    Boolean(
      currentCredentialDefinitionRegistration || hasPendingCredentialDefinition,
    );
  const publishProfile = usePublishIssuanceProfile(tenantId);
  const [pendingIssuanceProfile, setPendingIssuanceProfile] =
    useState<PendingIssuanceProfile | null>(() =>
      readPendingIssuanceProfile(tenantId),
    );
  const currentPendingIssuanceProfile =
    pendingIssuanceProfile?.tenantId === tenantId
      ? pendingIssuanceProfile
      : readPendingIssuanceProfile(tenantId);
  const profileReadinessPending =
    currentPendingIssuanceProfile?.status === 'published';
  const [apiClientReadinessPending, setApiClientReadinessPending] =
    useState(false);
  const [createdApiClient, setCreatedApiClient] = useState<{
    tenantId: string;
    credentials: ClientCredentials;
  } | null>(null);
  const query = useTenantOnboarding(tenantId, {
    refetchInterval: (data) => {
      const credentialDefinitionReady =
        data?.steps.find(
          (step) => step.name === 'register-credential-definition',
        )?.completed === true;
      const issuanceProfileReady =
        data?.steps.find((step) => step.name === 'create-issuance-profile')
          ?.completed === true;
      const apiClientReady =
        data?.steps.find((step) => step.name === 'register-api-client')
          ?.completed === true;
      return (!registrationFailed &&
        (registrationInProgress || hasReadyCredentialDefinition) &&
        !credentialDefinitionReady) ||
        (profileReadinessPending && !issuanceProfileReady) ||
        (apiClientReadinessPending && !apiClientReady)
        ? 3_000
        : false;
    },
  });
  const onboardingCredentialDefinitionReady =
    query.data?.steps.find(
      (step) => step.name === 'register-credential-definition',
    )?.completed === true;
  const registrationFailureDetail =
    registrationOperationQuery.data?.problem_details?.detail?.trim() ||
    registrationOperationQuery.data?.result?.message?.trim() ||
    t('tenantOnboarding.registrationFailureUnknown');

  const onRegistrationStarted = (
    operation: CredentialDefinitionRegistrationOperation,
  ) => {
    onStepReset();
    setStartedCredentialDefinitionRegistration({
      tenantId: tenantId ?? '',
      operationId: operation.id,
      ...(operation.result?.credential_definition_id && {
        definitionId: operation.result.credential_definition_id,
      }),
    });
  };

  const publishProfileDraft = (profileId: string) => {
    if (!tenantId) return;
    const key = issuanceProfileDraftKey(tenantId);
    const draft = { tenantId, profileId, status: 'draft' as const };
    sessionStorage.setItem(key, profileId);
    sessionStorage.setItem(`${key}:status`, 'draft');
    setPendingIssuanceProfile(draft);
    publishProfile.mutate(profileId, {
      onSuccess: () => {
        const publishedProfile = { ...draft, status: 'published' as const };
        sessionStorage.setItem(`${key}:status`, 'published');
        setPendingIssuanceProfile(publishedProfile);
        onStepReset();
        void query.refetch();
      },
    });
  };

  const publishCreatedProfile = (profile: IssuanceProfile) => {
    if (profile.id) publishProfileDraft(profile.id);
  };

  const acknowledgeApiClientCredentials = () => {
    setCreatedApiClient(null);
    onStepReset();
    setApiClientReadinessPending(true);
    void query.refetch();
  };

  const onApiClientCredentialsCreated = (credentials: ClientCredentials) => {
    if (tenantId) setCreatedApiClient({ tenantId, credentials });
  };

  useEffect(() => {
    const profileReady =
      query.data?.steps.find((step) => step.name === 'create-issuance-profile')
        ?.completed === true;
    if (tenantId && profileReadinessPending && profileReady) {
      const key = issuanceProfileDraftKey(tenantId);
      sessionStorage.removeItem(key);
      sessionStorage.removeItem(`${key}:status`);
    }
  }, [profileReadinessPending, query.data, tenantId]);

  return {
    query,
    definitionsQuery,
    registration: {
      failed: registrationFailed,
      inProgress: registrationInProgress,
      readinessPending:
        hasReadyCredentialDefinition && !onboardingCredentialDefinitionReady,
      operationQuery: registrationOperationQuery,
      failureDetail: registrationFailureDetail,
      onboardingReady: onboardingCredentialDefinitionReady,
      onStarted: onRegistrationStarted,
    },
    issuanceProfile: {
      current: currentPendingIssuanceProfile,
      readinessPending: profileReadinessPending,
      mutation: publishProfile,
      publishDraft: publishProfileDraft,
      onCreated: publishCreatedProfile,
    },
    apiClient: {
      credentials:
        createdApiClient && createdApiClient.tenantId === tenantId
          ? createdApiClient.credentials
          : null,
      readinessPending: apiClientReadinessPending,
      onCredentialsCreated: onApiClientCredentialsCreated,
      onAcknowledgeCredentials: acknowledgeApiClientCredentials,
    },
  };
}

export type TenantOnboardingSetupState = ReturnType<
  typeof useTenantOnboardingSetup
>;
