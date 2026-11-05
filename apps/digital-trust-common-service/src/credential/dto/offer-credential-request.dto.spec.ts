import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { OfferCredentialRequestDto } from './offer-credential-request.dto';

describe('OfferCredentialRequestDto', () => {
  const payload = () => ({
    credential_definition_id: '123e4567-e89b-12d3-a456-426614174001',
    credential: { credentialSubject: { given_name: 'Alice' } },
    delivery: {
      protocol: 'didcomm-v1',
      connection_id: '123e4567-e89b-12d3-a456-426614174000',
    },
  });
  const check = (value: unknown) =>
    validate(plainToInstance(OfferCredentialRequestDto, value), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts definition mode without caller-supplied format', async () => {
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
        credential: payload().credential,
        delivery: payload().delivery,
      }),
    ).toHaveLength(0);
  });

  it.each(['format', 'connection_id', 'attributes'])(
    'rejects obsolete top-level %s',
    async (field) => {
      expect(
        await check({ ...payload(), [field]: 'obsolete' }),
      ).not.toHaveLength(0);
    },
  );

  it.each([null, [], 'invalid', undefined])(
    'rejects invalid credential %p',
    async (credential) => {
      expect(await check({ ...payload(), credential })).not.toHaveLength(0);
    },
  );

  it.each([null, [], 'invalid', undefined])(
    'rejects invalid subject %p',
    async (credentialSubject) => {
      expect(
        await check({ ...payload(), credential: { credentialSubject } }),
      ).not.toHaveLength(0);
    },
  );

  it.each(['didcomm-v2', 'oid4vci', undefined])(
    'rejects unsupported delivery %p',
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
        delivery: { protocol: 'didcomm-v1', connection_id: 'invalid' },
      }),
    ).not.toHaveLength(0);
  });

  it('rejects unknown nested options and issuer-controlled credential fields', async () => {
    expect(
      await check({
        ...payload(),
        credential: { ...payload().credential, proof: {} },
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
