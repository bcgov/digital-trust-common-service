import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ListVerificationProfilesQueryDto } from './list-verification-profiles-query.dto';

describe('ListVerificationProfilesQueryDto', () => {
  it('coerces the public=true query string to a boolean', async () => {
    const dto = plainToInstance(ListVerificationProfilesQueryDto, {
      public: 'true',
      limit: '10',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.isPublic).toBe(true);
    expect(dto.limit).toBe(10);
  });

  it('coerces the public=false query string to a boolean', async () => {
    const dto = plainToInstance(ListVerificationProfilesQueryDto, {
      public: 'false',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.isPublic).toBe(false);
  });

  it('rejects a non-boolean-like public value', async () => {
    const dto = plainToInstance(ListVerificationProfilesQueryDto, {
      public: 'not-a-boolean',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'isPublic')).toBe(true);
  });
});
