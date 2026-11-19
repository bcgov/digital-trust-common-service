import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { OfferCredentialRequestDto } from './offer-credential-request.dto';

describe('OfferCredentialRequestDto', () => {
  const payload = () => ({
    profile_id: 'diploma/1.0',
    claims: { given_name: 'Alice' },
    delivery: {
      connection_id: '123e4567-e89b-12d3-a456-426614174000',
    },
  });
  const check = (value: unknown) =>
    validate(plainToInstance(OfferCredentialRequestDto, value), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts a profile offer without caller-supplied protocol or format', async () => {
    expect(await check(payload())).toHaveLength(0);
  });

  it.each([true, false])(
    'accepts boolean auto_issue %p',
    async (auto_issue) => {
      expect(
        await check({ ...payload(), options: { auto_issue } }),
      ).toHaveLength(0);
    },
  );

  it('accepts empty options to preserve defaults', async () => {
    expect(await check({ ...payload(), options: {} })).toHaveLength(0);
  });

  it.each([null, 'false', 0, 1, {}, []])(
    'rejects non-boolean auto_issue %p without coercion',
    async (auto_issue) => {
      expect(
        await check({ ...payload(), options: { auto_issue } }),
      ).not.toHaveLength(0);
    },
  );

  it.each([null, [], 'invalid', false])(
    'rejects invalid options %p',
    async (options) => {
      expect(await check({ ...payload(), options })).not.toHaveLength(0);
    },
  );

  it.each(['auto_remove', 'auto_remove_on_failure', 'auto_offer'])(
    'rejects unsupported option %s',
    async (key) => {
      expect(
        await check({ ...payload(), options: { [key]: true } }),
      ).not.toHaveLength(0);
    },
  );

  it('accepts profile mode', async () => {
    expect(
      await check({
        profile_id: 'employment/1.0',
        claims: payload().claims,
        delivery: payload().delivery,
      }),
    ).toHaveLength(0);
  });

  it.each([
    'format',
    'connection_id',
    'attributes',
    'credential_definition_id',
    'credential',
    'credentialSubject',
  ])('rejects obsolete top-level %s', async (field) => {
    expect(await check({ ...payload(), [field]: 'obsolete' })).not.toHaveLength(
      0,
    );
  });

  it.each([null, [], 'invalid', undefined])(
    'rejects invalid claims %p',
    async (claims) => {
      expect(await check({ ...payload(), claims })).not.toHaveLength(0);
    },
  );

  it.each(['didcomm-v1', 'didcomm-v2', 'oid4vci'])(
    'rejects caller-supplied delivery protocol %p',
    async (protocol) => {
      expect(
        await check({
          ...payload(),
          delivery: { ...payload().delivery, protocol },
        }),
      ).not.toHaveLength(0);
    },
  );

  it('rejects a malformed nested connection ID', async () => {
    expect(
      await check({
        ...payload(),
        delivery: { connection_id: 'invalid' },
      }),
    ).not.toHaveLength(0);
  });

  it.each([undefined, null, '', 123])(
    'requires profile_id (%p)',
    async (profile_id) => {
      expect(await check({ ...payload(), profile_id })).not.toHaveLength(0);
    },
  );

  it('rejects the legacy credential wrapper and unknown delivery fields', async () => {
    expect(
      await check({
        ...payload(),
        credential: { credentialSubject: { given_name: 'Alice' }, proof: {} },
      }),
    ).not.toHaveLength(0);
    expect(
      await check({
        ...payload(),
        delivery: { ...payload().delivery, arbitrary: true },
      }),
    ).not.toHaveLength(0);
  });
});
