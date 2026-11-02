import { ValidationPipe } from '@nestjs/common';

import { CreateCredentialDefinitionDto } from './create-credential-definition.dto';
import { UpdateCredentialDefinitionDto } from './update-credential-definition.dto';

describe('credential definition registration contract', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const input = {
    name: 'Employee',
    schema: { id: 'schema-id' },
    options: { format: 'anoncreds' },
  };
  const validate = (body: object) =>
    pipe.transform(body, {
      type: 'body',
      metatype: CreateCredentialDefinitionDto,
    });

  it('transforms connector_id and accepts format options separately from metadata', async () => {
    const result = await validate({
      ...input,
      connector_id: '123e4567-e89b-42d3-a456-426614174001',
      issuer: { method: 'indy' },
      options: {
        format: 'anoncreds',
        tag: 'test',
        status: { revocation: { enabled: true } },
      },
      metadata: {
        tag: 'test',
        revocation: { enabled: true },
        issuer: 'DMV',
      },
    });
    expect(result.connectorId).toBe('123e4567-e89b-42d3-a456-426614174001');
    expect(result.options.format).toBe('anoncreds');
    expect(result.options.tag).toBe('test');
    expect(result.options.status.revocation.enabled).toBe(true);
    expect(result.metadata.revocation.enabled).toBe(true);
    expect(result.metadata.issuer).toBe('DMV');
  });

  it.each(['anoncreds', 'sd-jwt', 'mdl', 'w3c-vc'])(
    'accepts the %s credential format inside options',
    async (format) => {
      await expect(
        validate({ ...input, options: { format } }),
      ).resolves.toMatchObject({
        options: { format },
      });
    },
  );

  it('accepts a free-form schema definition selected by options.format', async () => {
    const schema = {
      definition: {
        type: 'object',
        properties: { credentialSubject: { type: 'object' } },
      },
    };

    await expect(
      validate({
        ...input,
        options: { format: 'w3c-vc' },
        schema,
      }),
    ).resolves.toMatchObject({ schema });
  });

  it('requires format within options and rejects root format', async () => {
    await expect(validate({ ...input, options: {} })).rejects.toThrow();
    await expect(validate({ ...input, format: 'anoncreds' })).rejects.toThrow();
    await expect(
      validate({
        ...input,
        options: { format: 'anoncreds', revocation: { enabled: false } },
      }),
    ).rejects.toThrow();
  });

  it.each(['draft', 'published'])(
    'accepts %s as a credential-definition creation status',
    async (status) => {
      const request =
        status === 'draft'
          ? {
              ...input,
              status,
              connector_id: '123e4567-e89b-42d3-a456-426614174001',
              schema: {
                definition: {
                  schema_name: 'Employee',
                  schema_version: '1.0',
                  attr_names: ['name'],
                },
              },
            }
          : { ...input, status };
      await expect(validate(request)).resolves.toMatchObject({ status });
    },
  );

  it('requires schema.definition and connector_id for drafts', async () => {
    const connectorId = '123e4567-e89b-42d3-a456-426614174001';
    const schema = {
      definition: {
        schema_name: 'Employee',
        schema_version: '1.0',
        attr_names: ['name'],
      },
    };

    await expect(
      validate({ ...input, status: 'draft', connector_id: connectorId }),
    ).rejects.toThrow();
    await expect(
      validate({
        ...input,
        status: 'draft',
        connector_id: connectorId,
        schema,
      }),
    ).resolves.toMatchObject({ status: 'draft', connectorId });
    await expect(
      validate({ ...input, status: 'draft', schema }),
    ).rejects.toThrow();
  });

  it('rejects deprecated as a credential-definition creation status', async () => {
    await expect(
      validate({ ...input, status: 'deprecated' }),
    ).rejects.toThrow();
  });

  it('does not accept options on PATCH', async () => {
    const patchPipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      patchPipe.transform(
        { options: { tag: 'changed' } },
        { type: 'body', metatype: UpdateCredentialDefinitionDto },
      ),
    ).rejects.toThrow();
  });

  it('rejects null status on PATCH', async () => {
    const patchPipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      patchPipe.transform({}, {
        type: 'body',
        metatype: UpdateCredentialDefinitionDto,
      }),
    ).resolves.toBeDefined();
    await expect(
      patchPipe.transform(
        { status: null },
        { type: 'body', metatype: UpdateCredentialDefinitionDto },
      ),
    ).rejects.toThrow();
  });

  it.each([
    { external_id: 'legacy' },
    { connector_type: 'traction' },
    { schema_definition: {} },
    { issuer: { private_key: 'not-accepted' } },
    { schema: { id: 'schema-id', unexpected: true } },
    { schema: { type: 'json-schema', id: 'schema-id' } },
    { options: { format: 'application/vc' } },
    { name: '' },
    { schema: [] },
    { schema: { id: null } },
    { issuer: { id: null } },
    { issuer: null },
    { connector_id: null },
    { schema: {} },
    { schema: { id: 'schema-id', definition: {} } },
  ])('rejects unsupported or malformed input %j', async (change) => {
    await expect(validate({ ...input, ...change })).rejects.toThrow();
  });
});
