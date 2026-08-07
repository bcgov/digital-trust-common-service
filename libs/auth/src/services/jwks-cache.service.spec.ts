import { OidcConfigService } from '@app/oidc';
import { ConfigService } from '@nestjs/config';

import { JwksCacheService } from './jwks-cache.service';

describe('JwksCacheService', () => {
  let service: JwksCacheService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    service = new JwksCacheService(
      {
        getConfig: () => ({
          issuer: 'http://localhost:3000/oidc',
        }),
      } as OidcConfigService,
      {
        get: (_key: string, defaultValue?: unknown) => defaultValue,
      } as ConfigService,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('fetches JWKS on first resolve and caches keys by kid', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        keys: [{ kid: 'key-1', kty: 'RSA', n: 'abc', e: 'AQAB' }],
      }),
    });

    const key = await service.resolveKey('key-1');

    expect(key.kid).toBe('key-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/oidc/jwks', {
      headers: { Accept: 'application/json' },
    });

    await service.resolveKey('key-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes when kid is missing from cache', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => ({
          keys: [{ kid: 'key-1', kty: 'RSA', n: 'abc', e: 'AQAB' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => ({
          keys: [{ kid: 'key-2', kty: 'RSA', n: 'def', e: 'AQAB' }],
        }),
      });

    await service.resolveKey('key-1');
    const key = await service.resolveKey('key-2');

    expect(key.kid).toBe('key-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes after TTL expiry', async () => {
    jest.useFakeTimers();

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        keys: [{ kid: 'key-1', kty: 'RSA', n: 'abc', e: 'AQAB' }],
      }),
    });

    await service.resolveKey('key-1');
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);
    await service.resolveKey('key-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('uses JWT_JWKS_URI when configured', async () => {
    service = new JwksCacheService(
      {
        getConfig: () => ({
          issuer: 'http://localhost:3000/oidc',
        }),
      } as OidcConfigService,
      {
        get: (key: string, defaultValue?: unknown) =>
          key === 'JWT_JWKS_URI' ? 'http://custom.example/jwks' : defaultValue,
      } as ConfigService,
    );

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        keys: [{ kid: 'key-1', kty: 'RSA', n: 'abc', e: 'AQAB' }],
      }),
    });

    await service.resolveKey('key-1');

    expect(fetchMock).toHaveBeenCalledWith('http://custom.example/jwks', {
      headers: { Accept: 'application/json' },
    });
  });

  it('throws when JWKS fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(service.resolveKey('missing')).rejects.toThrow(
      'JWKS fetch failed with status 503',
    );
  });

  it('throws when refreshed JWKS does not contain the requested kid', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        keys: [{ kid: 'other-key', kty: 'RSA', n: 'abc', e: 'AQAB' }],
      }),
    });

    await expect(service.resolveKey('missing-kid')).rejects.toThrow(
      'Signing key "missing-kid" not found in JWKS',
    );
  });

  it('throws when JWKS response is missing a keys array', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({}),
    });

    await expect(service.resolveKey('key-1')).rejects.toThrow(
      'JWKS response is missing a keys array',
    );
  });

  it('clearCache forces the next resolve to fetch again within TTL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        keys: [{ kid: 'key-1', kty: 'RSA', n: 'abc', e: 'AQAB' }],
      }),
    });

    await service.resolveKey('key-1');
    service.clearCache();
    await service.resolveKey('key-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores JWKS entries without a usable kid', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        keys: [
          { kid: '', kty: 'RSA' },
          { kty: 'RSA', n: 'abc', e: 'AQAB' },
        ],
      }),
    });

    await expect(service.resolveKey('key-1')).rejects.toThrow(
      'Signing key "key-1" not found in JWKS',
    );
  });
});
