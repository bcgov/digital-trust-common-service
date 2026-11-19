import { Test, TestingModule } from '@nestjs/testing';

import { TenantOnboardingRepository } from './tenant-onboarding.repository';
import {
  TenantOnboardingService,
  TenantOnboardingStep,
} from './tenant-onboarding.service';

describe('TenantOnboardingService', () => {
  let service: TenantOnboardingService;
  const onboarding = {
    hasActiveConnector: jest.fn(),
    hasPublishedRegisteredCredentialDefinition: jest.fn(),
    hasPublishedIssuanceProfile: jest.fn(),
    hasActiveClientCredentials: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    onboarding.hasActiveConnector.mockResolvedValue(false);
    onboarding.hasPublishedRegisteredCredentialDefinition.mockResolvedValue(
      false,
    );
    onboarding.hasPublishedIssuanceProfile.mockResolvedValue(false);
    onboarding.hasActiveClientCredentials.mockResolvedValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantOnboardingService,
        { provide: TenantOnboardingRepository, useValue: onboarding },
      ],
    }).compile();

    service = module.get(TenantOnboardingService);
  });

  it('reports incomplete steps, prerequisite blockers, and zero progress', async () => {
    await expect(service.getReadiness('tenant-1')).resolves.toEqual({
      steps: [
        {
          name: TenantOnboardingStep.CONFIGURE_CONNECTOR,
          completed: false,
          blockedBy: [],
        },
        {
          name: TenantOnboardingStep.REGISTER_CREDENTIAL_DEFINITION,
          completed: false,
          blockedBy: [TenantOnboardingStep.CONFIGURE_CONNECTOR],
        },
        {
          name: TenantOnboardingStep.CREATE_ISSUANCE_PROFILE,
          completed: false,
          blockedBy: [
            TenantOnboardingStep.CONFIGURE_CONNECTOR,
            TenantOnboardingStep.REGISTER_CREDENTIAL_DEFINITION,
          ],
        },
        {
          name: TenantOnboardingStep.REGISTER_API_CLIENT,
          completed: false,
          blockedBy: [],
        },
      ],
      progressPercent: 0,
    });

    expect(onboarding.hasActiveConnector).toHaveBeenCalledWith('tenant-1');
    expect(
      onboarding.hasPublishedRegisteredCredentialDefinition,
    ).toHaveBeenCalledWith('tenant-1');
    expect(onboarding.hasPublishedIssuanceProfile).toHaveBeenCalledWith(
      'tenant-1',
    );
    expect(onboarding.hasActiveClientCredentials).toHaveBeenCalledWith(
      'tenant-1',
    );
  });

  it('counts completed resources and keeps the independent API client step actionable', async () => {
    onboarding.hasActiveClientCredentials.mockResolvedValue(true);

    const result = await service.getReadiness('tenant-1');

    expect(result.progressPercent).toBe(25);
    expect(result.steps[3]).toEqual({
      name: TenantOnboardingStep.REGISTER_API_CLIENT,
      completed: true,
      blockedBy: [],
    });
  });

  it('reports full progress when every resource is ready', async () => {
    onboarding.hasActiveConnector.mockResolvedValue(true);
    onboarding.hasPublishedRegisteredCredentialDefinition.mockResolvedValue(
      true,
    );
    onboarding.hasPublishedIssuanceProfile.mockResolvedValue(true);
    onboarding.hasActiveClientCredentials.mockResolvedValue(true);

    await expect(service.getReadiness('tenant-1')).resolves.toMatchObject({
      progressPercent: 100,
      steps: [
        { completed: true },
        { completed: true, blockedBy: [] },
        { completed: true, blockedBy: [] },
        { completed: true },
      ],
    });
  });
});
