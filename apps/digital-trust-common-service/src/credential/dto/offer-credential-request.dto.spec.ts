import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';

import { OfferCredentialRequestDto } from './offer-credential-request.dto';

describe('OfferCredentialRequestDto', () => {
  it('accepts a profile-mode payload', async () => {
    const dto = plainToInstance(OfferCredentialRequestDto, {
      profile_id: 'employment/1.0.0',
      connection_id: '123e4567-e89b-12d3-a456-426614174000',
      attributes: { given_name: 'Alice' },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.profileId).toBe('employment/1.0.0');
    expect(dto.connectionId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(dto.attributes).toEqual({ given_name: 'Alice' });
  });

  it('accepts a legacy credential_definition_id + format payload', async () => {
    const dto = plainToInstance(OfferCredentialRequestDto, {
      credential_definition_id: '123e4567-e89b-12d3-a456-426614174001',
      format: CredentialDefinitionFormat.ANONCREDS,
      connection_id: '123e4567-e89b-12d3-a456-426614174000',
      attributes: { given_name: 'Alice' },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects a non-UUID connection_id', async () => {
    const dto = plainToInstance(OfferCredentialRequestDto, {
      profile_id: 'employment/1.0.0',
      connection_id: 'not-a-uuid',
      attributes: {},
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'connectionId')).toBe(
      true,
    );
  });

  it('rejects an unknown format value', async () => {
    const dto = plainToInstance(OfferCredentialRequestDto, {
      credential_definition_id: '123e4567-e89b-12d3-a456-426614174001',
      format: 'not-a-format',
      connection_id: '123e4567-e89b-12d3-a456-426614174000',
      attributes: {},
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'format')).toBe(true);
  });
});
