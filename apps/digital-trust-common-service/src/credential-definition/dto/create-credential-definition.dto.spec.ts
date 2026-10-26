import { ValidationPipe } from '@nestjs/common';

import { CreateCredentialDefinitionDto } from './create-credential-definition.dto';

describe('credential definition registration contract', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const input = {
    name: 'Employee',
    format: 'anoncreds',
    schema: { id: 'schema-id' },
  };
  const validate = (body: object) =>
    pipe.transform(body, {
      type: 'body',
      metatype: CreateCredentialDefinitionDto,
    });

  it('transforms connector_id and accepts registration settings in metadata', async () => {
    const result = await validate({
      ...input,
      connector_id: '123e4567-e89b-42d3-a456-426614174001',
      issuer: { method: 'indy' },
      metadata: {
        tag: 'test',
        revocation: { enabled: true },
        issuer: 'DMV',
      },
    });
    expect(result.connectorId).toBe('123e4567-e89b-42d3-a456-426614174001');
    expect(result.metadata.revocation.enabled).toBe(true);
    expect(result.metadata.issuer).toBe('DMV');
  });

  it.each([
    { external_id: 'legacy' },
    { connector_type: 'traction' },
    { schema_definition: {} },
    { options: { tag: 'test' } },
    { issuer: { private_key: 'not-accepted' } },
    { schema: { id: 'schema-id', unexpected: true } },
    { schema: { type: 'json-schema', id: 'schema-id' } },
    { format: 'application/vc' },
    { name: '' },
    { schema: [] },
    { schema: { id: null } },
    { issuer: { id: null } },
    { issuer: null },
    { connector_id: null },
  ])('rejects unsupported or malformed input %j', async (change) => {
    await expect(validate({ ...input, ...change })).rejects.toThrow();
  });
});
