import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateConnectorCredentialDto } from './update-connector-credential.dto';

describe('UpdateConnectorCredentialDto', () => {
  it('accepts a webhook-secret-only credential update', async () => {
    const dto = plainToInstance(UpdateConnectorCredentialDto, {
      credentials: { webhook_secret: 'rotation-test-placeholder' },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each(['api_key', 'traction_tenant_id', 'webhook_secret'])(
    'rejects null for the %s credential field',
    async (field) => {
      const dto = plainToInstance(UpdateConnectorCredentialDto, {
        credentials: { [field]: null },
      });

      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );

  it('rejects null credentials and endpoint values', async () => {
    const nullCredentials = plainToInstance(UpdateConnectorCredentialDto, {
      credentials: null,
    });
    const nullEndpoint = plainToInstance(UpdateConnectorCredentialDto, {
      endpoint_url: null,
    });

    await expect(validate(nullCredentials)).resolves.not.toHaveLength(0);
    await expect(validate(nullEndpoint)).resolves.not.toHaveLength(0);
  });
});
