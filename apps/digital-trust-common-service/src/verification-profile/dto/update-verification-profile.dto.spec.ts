import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateVerificationProfileDto } from './update-verification-profile.dto';

describe('UpdateVerificationProfileDto', () => {
  it('accepts a partial payload with nested predicates', async () => {
    const dto = plainToInstance(UpdateVerificationProfileDto, {
      description: 'Updated description',
      predicates: [{ attribute: 'age', condition: '>=', value: '21' }],
      metadata: { note: 'reviewed' },
      public: false,
      protocol_hint: 'oid4vp',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.predicates).toHaveLength(1);
    expect(dto.predicates?.[0].value).toBe('21');
    expect(dto.isPublic).toBe(false);
  });

  it('rejects a malformed nested predicate', async () => {
    const dto = plainToInstance(UpdateVerificationProfileDto, {
      predicates: [{ attribute: 'age', condition: '>=' }],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'predicates')).toBe(true);
  });
});
