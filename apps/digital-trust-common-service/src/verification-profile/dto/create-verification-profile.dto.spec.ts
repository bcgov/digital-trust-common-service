import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateVerificationProfileDto } from './create-verification-profile.dto';

describe('CreateVerificationProfileDto', () => {
  it('accepts a linked presentation definition', async () => {
    const dto = plainToInstance(CreateVerificationProfileDto, {
      name: 'Age Verification',
      version: '1.0.0',
      presentation_definition_id: '123e4567-e89b-42d3-a456-426614174003',
      public: true,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.presentationDefinitionId).toBe(
      '123e4567-e89b-42d3-a456-426614174003',
    );
    expect(dto.isPublic).toBe(true);
  });

  it('rejects inline definitions and a missing definition ID', async () => {
    const dto = plainToInstance(CreateVerificationProfileDto, {
      name: 'Age Verification',
      version: '1.0.0',
      presentation_definition: { input_descriptors: [] },
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'presentation_definition',
        'presentationDefinitionId',
      ]),
    );
  });
});
