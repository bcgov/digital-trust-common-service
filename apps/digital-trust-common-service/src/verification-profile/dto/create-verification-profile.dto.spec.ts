import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateVerificationProfileDto } from './create-verification-profile.dto';

describe('CreateVerificationProfileDto', () => {
  it('accepts a payload with nested predicates', async () => {
    const dto = plainToInstance(CreateVerificationProfileDto, {
      name: 'Age Verification',
      version: '1.0.0',
      issuance_profile_id: '123e4567-e89b-12d3-a456-426614174000',
      presentation_definition: { input_descriptors: [] },
      predicates: [{ attribute: 'age', condition: '>=', value: '18' }],
      public: true,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.predicates).toHaveLength(1);
    expect(dto.predicates?.[0].attribute).toBe('age');
    expect(dto.isPublic).toBe(true);
  });

  it('rejects a malformed nested predicate', async () => {
    const dto = plainToInstance(CreateVerificationProfileDto, {
      name: 'Age Verification',
      version: '1.0.0',
      issuance_profile_id: '123e4567-e89b-12d3-a456-426614174000',
      presentation_definition: { input_descriptors: [] },
      predicates: [{ attribute: 'age', condition: 'not-a-condition' }],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'predicates')).toBe(true);
  });
});
