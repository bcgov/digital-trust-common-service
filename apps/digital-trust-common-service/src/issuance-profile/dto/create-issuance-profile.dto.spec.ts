import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateIssuanceProfileDto } from './create-issuance-profile.dto';
import { UpdateIssuanceProfileDto } from './update-issuance-profile.dto';

describe('issuance profile request validation', () => {
  const body = {
    name: 'diploma',
    version: '1.0',
    credential_definition_id: '123e4567-e89b-12d3-a456-426614174001',
    claims: { required: ['name'], properties: {} },
  };
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it('transforms profile claims and defaults the supported delivery protocol', async () => {
    const dto = plainToInstance(CreateIssuanceProfileDto, body);
    expect(await validate(dto, options)).toHaveLength(0);
    expect(dto.claims).toEqual(body.claims);
    expect(dto.delivery).toBeUndefined();
    expect(
      plainToInstance(CreateIssuanceProfileDto, {
        ...body,
        delivery: {},
      }).delivery?.protocol,
    ).toBe('didcomm-v1');
  });

  it('allows omitted claim overlays', async () => {
    expect(
      await validate(
        plainToInstance(CreateIssuanceProfileDto, {
          ...body,
          claims: undefined,
        }),
        options,
      ),
    ).toHaveLength(0);
  });

  it.each([
    'attribute_schema',
    'defaults',
    'protocol_hint',
    'claim_constraints',
  ])('rejects legacy %s', async (key) => {
    expect(
      await validate(
        plainToInstance(CreateIssuanceProfileDto, {
          ...body,
          [key]: {},
        }),
        options,
      ),
    ).not.toHaveLength(0);
  });

  it.each([null, { protocol: 'auto' }, { protocol: 'oid4vci' }])(
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
          delivery: { protocol: 'didcomm-v1', unknown: true },
        }),
        options,
      ),
    ).not.toHaveLength(0);
  });

  it.each([null, [], 'invalid'])(
    'rejects invalid claims %p',
    async (claims) => {
      expect(
        await validate(
          plainToInstance(CreateIssuanceProfileDto, {
            ...body,
            claims,
          }),
          options,
        ),
      ).not.toHaveLength(0);
    },
  );

  it('allows claims edits on draft profiles', async () => {
    expect(
      await validate(
        plainToInstance(UpdateIssuanceProfileDto, {
          claims: body.claims,
        }),
        options,
      ),
    ).toHaveLength(0);
  });
});
