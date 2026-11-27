import type { ParseKeys } from 'i18next';

import type { TenantOnboarding } from '@/lib/api/resources/tenants';

export type TenantOnboardingStepName =
  TenantOnboarding['steps'][number]['name'];

export const TENANT_ONBOARDING_STEP_CONTENT: Record<
  TenantOnboardingStepName,
  { title: ParseKeys; reason: ParseKeys; action: ParseKeys }
> = {
  'configure-connector': {
    title: 'tenantOnboarding.steps.connector.title',
    reason: 'tenantOnboarding.steps.connector.reason',
    action: 'tenantOnboarding.steps.connector.action',
  },
  'register-credential-definition': {
    title: 'tenantOnboarding.steps.credentialDefinition.title',
    reason: 'tenantOnboarding.steps.credentialDefinition.reason',
    action: 'tenantOnboarding.steps.credentialDefinition.action',
  },
  'create-issuance-profile': {
    title: 'tenantOnboarding.steps.issuanceProfile.title',
    reason: 'tenantOnboarding.steps.issuanceProfile.reason',
    action: 'tenantOnboarding.steps.issuanceProfile.action',
  },
  'register-api-client': {
    title: 'tenantOnboarding.steps.apiClient.title',
    reason: 'tenantOnboarding.steps.apiClient.reason',
    action: 'tenantOnboarding.steps.apiClient.action',
  },
};
