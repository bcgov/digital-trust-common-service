import { randomUUID } from 'crypto';

import { registrationErrorText } from './registration-backend-error';

describe('registrationErrorText', () => {
  it('redacts known credentials even without labels and removes credential-bearing URLs', () => {
    const secret = randomUUID();
    expect(
      registrationErrorText(
        `Rejected ${secret}\nhttps://example.test?secret=${secret}`,
        [secret],
      ),
    ).toBe('Rejected [REDACTED] [URL REDACTED]');
  });

  it.each([
    'api_key',
    'password',
    'client_secret',
    'access_token',
    'Authorization',
  ])('redacts labelled %s values', (label) => {
    const secret = randomUUID();
    expect(registrationErrorText(`${label}: "${secret}"`)).not.toContain(
      secret,
    );
    expect(registrationErrorText(`${label}=${secret}`)).not.toContain(secret);
  });

  it('bounds text and refuses structured bodies rather than serializing them', () => {
    expect(registrationErrorText('a'.repeat(10000))).toHaveLength(1024);
    expect(registrationErrorText({ error: 'not plain text' })).toBeUndefined();
  });
});
