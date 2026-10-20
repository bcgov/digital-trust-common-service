import { ValidationPipe } from '@nestjs/common';

import { RecoverCredentialDefinitionDto } from './recover-credential-definition.dto';

describe('registration recovery contract', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const validate = (body: object) =>
    pipe.transform(body, {
      type: 'body',
      metatype: RecoverCredentialDefinitionDto,
    });

  it('accepts an empty recovery request', async () => {
    await expect(validate({})).resolves.toBeInstanceOf(
      RecoverCredentialDefinitionDto,
    );
  });

  it('transforms wallet transaction hints', async () => {
    const id = '1b0d887a-9131-4653-a05c-ab3486875d01';
    expect(
      await validate({
        schema_transaction_id: id,
        definition_transaction_id: id,
      }),
    ).toMatchObject({ schemaTransactionId: id, definitionTransactionId: id });
  });

  it.each([
    { schema_transaction_id: null },
    { schema_transaction_id: 'invalid' },
    { definition_transaction_id: null },
    { definition_transaction_id: [] },
    { schema_id: 'unverified' },
    { retry: true },
    { clear_markers: true },
  ])('rejects unsupported input %j', async (input) => {
    await expect(validate(input)).rejects.toThrow();
  });
});
