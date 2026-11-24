import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateVerificationProfileDto } from './update-verification-profile.dto';

describe('UpdateVerificationProfileDto', () => {
  it('accepts a linked definition and profile settings', async () => {
    const dto = plainToInstance(UpdateVerificationProfileDto, {
      description: 'Updated description',
      presentation_definition_id: '123e4567-e89b-42d3-a456-426614174003',
      metadata: { note: 'reviewed' },
      public: false,
      protocol_hint: 'didcomm',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.presentationDefinitionId).toBe(
      '123e4567-e89b-42d3-a456-426614174003',
    );
    expect(dto.isPublic).toBe(false);
  });

  it('requires a valid definition ID and rejects inline predicates', async () => {
    const dto = plainToInstance(UpdateVerificationProfileDto, {
      presentation_definition_id: 'not-a-uuid',
      predicates: [{ attribute: 'age', condition: '>=', value: '21' }],
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['predicates', 'presentationDefinitionId']),
    );
  });

  it('allows an unrelated patch and rejects unsupported delivery or protocol', async () => {
    expect(
      await validate(
        plainToInstance(UpdateVerificationProfileDto, {
          description: 'Updated',
        }),
      ),
    ).toHaveLength(0);
    for (const patch of [
      { presentation_definition_id: null },
      { delivery: null },
      { delivery: {} },
      { delivery: { protocol: 'oid4vp' } },
      { protocol_hint: 'oid4vp' },
    ]) {
      expect(
        await validate(plainToInstance(UpdateVerificationProfileDto, patch)),
      ).not.toHaveLength(0);
    }
  });
});
