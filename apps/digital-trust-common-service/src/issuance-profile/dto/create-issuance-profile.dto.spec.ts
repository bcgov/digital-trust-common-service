import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateIssuanceProfileDto } from './create-issuance-profile.dto';
import { UpdateIssuanceProfileDto } from './update-issuance-profile.dto';

describe('issuance profile request validation', () => {
  const body = {
    name: 'diploma',
    version: '1.0',
    credential_definition_id: '123e4567-e89b-12d3-a456-426614174001',
    delivery: { protocol: 'didcomm-v1' },
    claim_constraints: { '/name': { required: true, minLength: 1 } },
  };
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it('transforms the new request shape', async () => {
    const dto = plainToInstance(CreateIssuanceProfileDto, body);
    expect(await validate(dto, options)).toHaveLength(0);
    expect(dto.claimConstraints).toEqual(body.claim_constraints);
    expect(dto.delivery.protocol).toBe('didcomm-v1');
  });

  it('allows omitted constraints', async () => {
    expect(
      await validate(
        plainToInstance(CreateIssuanceProfileDto, {
          ...body,
          claim_constraints: undefined,
        }),
        options,
      ),
    ).toHaveLength(0);
  });

  it.each(['attribute_schema', 'defaults', 'protocol_hint'])(
    'rejects legacy %s',
    async (key) => {
      expect(
        await validate(
          plainToInstance(CreateIssuanceProfileDto, {
            ...body,
            [key]: {},
          }),
          options,
        ),
      ).not.toHaveLength(0);
    },
  );

  it.each([null, {}, { protocol: 'auto' }, { protocol: 'oid4vci' }, undefined])(
    'rejects invalid delivery %p',
    async (delivery) => {
      expect(
        await validate(
          plainToInstance(CreateIssuanceProfileDto, {
            ...body,
            delivery,
          }),
          options,
        ),
      ).not.toHaveLength(0);
    },
  );

  it('rejects unknown delivery settings', async () => {
    expect(
      await validate(
        plainToInstance(CreateIssuanceProfileDto, {
          ...body,
          delivery: { ...body.delivery, unknown: true },
        }),
        options,
      ),
    ).not.toHaveLength(0);
  });

  it.each([null, [], 'invalid'])(
    'rejects invalid constraints %p',
    async (claim_constraints) => {
      expect(
        await validate(
          plainToInstance(CreateIssuanceProfileDto, {
            ...body,
            claim_constraints,
          }),
          options,
        ),
      ).not.toHaveLength(0);
    },
  );

  it('allows delivery and constraints edits on draft profiles', async () => {
    expect(
      await validate(
        plainToInstance(UpdateIssuanceProfileDto, {
          delivery: body.delivery,
          claim_constraints: body.claim_constraints,
        }),
        options,
      ),
    ).toHaveLength(0);
  });
});
