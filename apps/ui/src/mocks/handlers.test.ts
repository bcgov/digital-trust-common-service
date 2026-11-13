import { describe, expect, it } from 'vitest';

import { listConnectors } from '@/lib/api/resources/connectors';
import {
  createCredentialDefinition,
  deleteCredentialDefinition,
  getCredentialDefinition,
  listCredentialDefinitions,
  registerCredentialDefinition,
  updateCredentialDefinition,
  type CreateCredentialDefinitionRequest,
} from '@/lib/api/resources/credential-definitions';
import {
  archiveIssuanceProfile,
  createIssuanceProfile,
  deleteIssuanceProfile,
  listIssuanceProfiles,
  publishIssuanceProfile,
  type CreateIssuanceProfileRequest,
} from '@/lib/api/resources/issuance-profiles';

import { mockCredentialDefinitions } from './handlers';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';
const connectorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const publishedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const draftId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const draftRequest: CreateCredentialDefinitionRequest = {
  name: 'Conference pass',
  connector_id: connectorId,
  status: 'draft',
  schema: {
    definition: {
      attributes: {},
      schema_name: 'Conference pass',
      schema_version: '1.0',
      version: '1.0',
    },
  },
  options: {
    format: 'anoncreds',
    tag: 'default',
    status: { revocation: { enabled: true } },
  },
  metadata: { description: 'Conference visitor credential' },
};

describe('shared issuance-profile mock handlers', () => {
  it('isolates archive and delete operations and retains archived name/version reservations', async () => {
    const body: CreateIssuanceProfileRequest = {
      name: 'Lifecycle profile',
      version: '1.0',
      credential_definition_id: publishedId,
      delivery: { protocol: 'didcomm-v1' },
    };
    const created = await createIssuanceProfile(tenantId, body);
    const profileId = created.id!;
    expect(created).toMatchObject({
      ...body,
      status: 'draft',
      claims: {},
      delivery: { protocol: 'didcomm-v1' },
    });
    expect((await listIssuanceProfiles(tenantId)).data[0]?.can_delete).toBe(
      true,
    );
    await expect(
      deleteIssuanceProfile(otherTenantId, profileId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      archiveIssuanceProfile(otherTenantId, profileId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      archiveIssuanceProfile(tenantId, profileId),
    ).rejects.toMatchObject({ status: 409 });
    await publishIssuanceProfile(tenantId, profileId);
    expect(await archiveIssuanceProfile(tenantId, profileId)).toMatchObject({
      id: profileId,
      status: 'deprecated',
    });
    await expect(createIssuanceProfile(tenantId, body)).rejects.toMatchObject({
      status: 409,
    });
    expect((await listIssuanceProfiles(tenantId)).data).toHaveLength(1);
    await deleteIssuanceProfile(tenantId, profileId);
    expect((await listIssuanceProfiles(tenantId)).data).toEqual([]);
  });

  it('only publishes drafts in the owning tenant', async () => {
    const created = await createIssuanceProfile(tenantId, {
      name: 'Employee profile',
      version: '1.0',
      credential_definition_id: publishedId,
      delivery: { protocol: 'didcomm-v1' },
    });
    const profileId = created.id!;
    await expect(
      publishIssuanceProfile(otherTenantId, profileId),
    ).rejects.toMatchObject({ status: 404 });
    expect(await publishIssuanceProfile(tenantId, profileId)).toMatchObject({
      id: profileId,
      status: 'published',
      tenant_id: tenantId,
    });
    await expect(
      publishIssuanceProfile(tenantId, profileId),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rechecks the credential definition before publication', async () => {
    const created = await createIssuanceProfile(tenantId, {
      name: 'Employee profile',
      version: '1.0',
      credential_definition_id: publishedId,
      delivery: { protocol: 'didcomm-v1' },
    });
    await deleteCredentialDefinition(tenantId, publishedId);
    await expect(
      publishIssuanceProfile(tenantId, created.id!),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('shared credential-definition mock handlers', () => {
  it('provides reset published and draft fixtures with usable connector bindings', async () => {
    const definitions = await listCredentialDefinitions(tenantId);
    const connectors = await listConnectors(tenantId);

    expect(definitions.data).toHaveLength(mockCredentialDefinitions.length);
    expect(definitions.data.map((definition) => definition.status)).toEqual([
      'published',
      'draft',
    ]);
    for (const definition of definitions.data) {
      expect(definition.connector_id).toBe(connectorId);
      expect(definition.schema_definition?.properties).toBeDefined();
      expect(connectors.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: definition.connector_id,
            tenant_id: tenantId,
            active: true,
          }),
        ]),
      );
    }
    expect((await listCredentialDefinitions(otherTenantId)).data).toEqual([]);
    expect((await listConnectors(otherTenantId)).data).toEqual([]);
    expect(await getCredentialDefinition(tenantId, draftId)).toMatchObject({
      name: 'Visitor pass',
      status: 'draft',
    });
  });

  it('persists draft creation, edits, publication and soft deletion', async () => {
    const created = await createCredentialDefinition(tenantId, draftRequest);
    const id = created.id!;
    expect(created).toMatchObject({
      name: draftRequest.name,
      connector_id: connectorId,
      tenant_id: tenantId,
      status: 'draft',
      external_id: null,
      registration_state: 'unverified',
      schema_definition:
        'definition' in draftRequest.schema
          ? draftRequest.schema.definition
          : {},
      options: draftRequest.options,
      version: '1.0',
      is_active: true,
    });
    expect(await getCredentialDefinition(tenantId, id)).toEqual(created);
    expect((await listCredentialDefinitions(tenantId)).data).toContainEqual(
      created,
    );

    const schema = {
      attributes: { visitor_name: 'string' },
      schema_name: 'Updated conference pass',
      schema_version: '2.0',
      version: '2.0',
    };
    const updated = await updateCredentialDefinition(tenantId, id, {
      name: 'Updated conference pass',
      schema_definition: schema,
      status: 'draft',
      connector_id: connectorId,
      metadata: { description: 'Updated description' },
    });
    expect(updated).toMatchObject({
      name: 'Updated conference pass',
      version: '2.0',
      schema_definition: schema,
      metadata: { description: 'Updated description' },
    });
    expect(await getCredentialDefinition(tenantId, id)).toEqual(updated);

    const operation = await registerCredentialDefinition(tenantId, {
      ...draftRequest,
      name: 'Updated conference pass',
      status: 'published',
      schema: { definition: schema },
      metadata: { description: 'Updated description' },
    });
    expect(operation).toMatchObject({
      type: 'credential-definition.register',
      state: 'pending',
      result: { credential_definition_id: id },
    });
    expect(await getCredentialDefinition(tenantId, id)).toMatchObject({
      status: 'published',
      registration_state: 'pending',
    });
    await deleteCredentialDefinition(tenantId, id);
    expect(
      (await listCredentialDefinitions(tenantId)).data.some(
        (item) => item.id === id,
      ),
    ).toBe(false);
    await expect(getCredentialDefinition(tenantId, id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      updateCredentialDefinition(tenantId, id, { name: 'Deleted' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteCredentialDefinition(tenantId, id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('deletes an existing published fixture without mutating seed data', async () => {
    await deleteCredentialDefinition(tenantId, publishedId);

    const definitions = await listCredentialDefinitions(tenantId);
    expect(definitions.data.map((definition) => definition.id)).toEqual([
      draftId,
    ]);
    expect(mockCredentialDefinitions[0]).toMatchObject({
      id: publishedId,
      is_active: true,
    });
  });

  it('does not expose or mutate definitions belonging to another tenant', async () => {
    await expect(
      getCredentialDefinition(otherTenantId, draftId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateCredentialDefinition(otherTenantId, draftId, {
        name: 'Cross-tenant edit',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteCredentialDefinition(otherTenantId, draftId),
    ).rejects.toMatchObject({ status: 404 });

    expect(await getCredentialDefinition(tenantId, draftId)).toMatchObject({
      name: 'Visitor pass',
      is_active: true,
    });
  });

  it('rejects connector bindings from a different tenant or a missing connector', async () => {
    await expect(
      createCredentialDefinition(otherTenantId, draftRequest),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateCredentialDefinition(tenantId, draftId, {
        connector_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await getCredentialDefinition(tenantId, draftId)).toMatchObject({
      connector_id: connectorId,
    });
  });

  it('rejects duplicate names and immutable published schema changes', async () => {
    await expect(
      createCredentialDefinition(tenantId, {
        ...draftRequest,
        name: 'Employee badge',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      updateCredentialDefinition(tenantId, draftId, {
        name: 'Employee badge',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      updateCredentialDefinition(tenantId, publishedId, {
        schema_definition: { properties: { changed: { type: 'string' } } },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateCredentialDefinition(tenantId, publishedId, {
        status: 'draft',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
