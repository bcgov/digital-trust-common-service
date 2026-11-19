import { Injectable } from '@nestjs/common';

import { TenantOnboardingRepository } from './tenant-onboarding.repository';

export enum TenantOnboardingStep {
  CONFIGURE_CONNECTOR = 'configure-connector',
  REGISTER_CREDENTIAL_DEFINITION = 'register-credential-definition',
  CREATE_ISSUANCE_PROFILE = 'create-issuance-profile',
  REGISTER_API_CLIENT = 'register-api-client',
}

export type TenantOnboardingStepReadiness = {
  name: TenantOnboardingStep;
  completed: boolean;
  blockedBy: TenantOnboardingStep[];
};

export type TenantOnboardingReadiness = {
  steps: TenantOnboardingStepReadiness[];
  progressPercent: number;
};

@Injectable()
export class TenantOnboardingService {
  public constructor(private readonly onboarding: TenantOnboardingRepository) {}

  public async getReadiness(
    tenantId: string,
  ): Promise<TenantOnboardingReadiness> {
    const [
      connectorReady,
      credentialDefinitionReady,
      issuanceProfileReady,
      apiClientReady,
    ] = await Promise.all([
      this.onboarding.hasActiveConnector(tenantId),
      this.onboarding.hasPublishedRegisteredCredentialDefinition(tenantId),
      this.onboarding.hasPublishedIssuanceProfile(tenantId),
      this.onboarding.hasActiveClientCredentials(tenantId),
    ]);

    const steps: TenantOnboardingStepReadiness[] = [
      {
        name: TenantOnboardingStep.CONFIGURE_CONNECTOR,
        completed: connectorReady,
        blockedBy: [],
      },
      {
        name: TenantOnboardingStep.REGISTER_CREDENTIAL_DEFINITION,
        completed: credentialDefinitionReady,
        blockedBy:
          credentialDefinitionReady || connectorReady
            ? []
            : [TenantOnboardingStep.CONFIGURE_CONNECTOR],
      },
      {
        name: TenantOnboardingStep.CREATE_ISSUANCE_PROFILE,
        completed: issuanceProfileReady,
        blockedBy: issuanceProfileReady
          ? []
          : [
              ...(!connectorReady
                ? [TenantOnboardingStep.CONFIGURE_CONNECTOR]
                : []),
              ...(!credentialDefinitionReady
                ? [TenantOnboardingStep.REGISTER_CREDENTIAL_DEFINITION]
                : []),
            ],
      },
      {
        name: TenantOnboardingStep.REGISTER_API_CLIENT,
        completed: apiClientReady,
        blockedBy: [],
      },
    ];

    return {
      steps,
      progressPercent: Math.round(
        (steps.filter((step) => step.completed).length / steps.length) * 100,
      ),
    };
  }
}
