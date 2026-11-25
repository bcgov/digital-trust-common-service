import type { CredentialDefinition } from '@/lib/api/resources/credential-definitions';

export function eligibleDefinitions(
  definitions: readonly CredentialDefinition[],
) {
  return definitions.filter(
    (definition) =>
      definition.id &&
      definition.status === 'published' &&
      definition.registration_state === 'ready' &&
      definition.external_id &&
      definition.connector_id,
  );
}
