import {
  CredentialDefinitionFormat,
  isCredentialDefinitionReadyForIssuance,
} from './credential-definition.entity';

describe('credential definition issuance readiness', () => {
  const ready = {
    format: CredentialDefinitionFormat.ANONCREDS,
    registrationState: 'ready' as const,
    externalId: 'published-definition',
    connectorId: 'connector',
  };

  it('requires a published AnonCreds artifact and its pinned connector', () => {
    expect(isCredentialDefinitionReadyForIssuance(ready)).toBe(true);
    expect(
      isCredentialDefinitionReadyForIssuance({
        ...ready,
        externalId: null,
      }),
    ).toBe(false);
    expect(
      isCredentialDefinitionReadyForIssuance({
        ...ready,
        connectorId: null,
      }),
    ).toBe(false);
  });

  it.each([
    CredentialDefinitionFormat.SD_JWT,
    CredentialDefinitionFormat.MDL,
    CredentialDefinitionFormat.W3C_VC,
  ])(
    'does not make the unsupported %s placeholder issuance-ready',
    (format) => {
      const placeholder = { ...ready, format, externalId: null };
      expect(isCredentialDefinitionReadyForIssuance(placeholder)).toBe(false);
    },
  );
});
