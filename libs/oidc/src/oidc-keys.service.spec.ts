import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { exportJWK, generateKeyPair } from 'jose';

import { OidcKeysService } from './oidc-keys.service';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('jose', () => ({
  generateKeyPair: jest.fn(),
  exportJWK: jest.fn(),
}));

describe('OidcKeysService', () => {
  let mockGet: jest.Mock;

  const keysPath = '/tmp/oidc-keys.json';

  const validJwks = JSON.stringify({
    keys: [
      { kid: 'key-1', kty: 'RSA', alg: 'RS256', use: 'sig', d: 'private-d' },
    ],
  });

  const buildService = async (
    values: Record<string, string | undefined>,
  ): Promise<OidcKeysService> => {
    mockGet = jest.fn(
      (key: string, fallback?: string) => values[key] ?? fallback,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcKeysService,
        { provide: ConfigService, useValue: { get: mockGet } },
      ],
    }).compile();

    return module.get(OidcKeysService);
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('loads and validates an existing JWKS file', async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue(validJwks);

    const service = await buildService({ OIDC_KEYS_PATH: keysPath });
    await service.onModuleInit();

    expect(service.getJwks()).toEqual(JSON.parse(validJwks));
    expect(readFileSync).toHaveBeenCalledWith(keysPath, 'utf8');
  });

  it('loads a multi-key (rotated) JWKS, preserving newest-first order', async () => {
    const rotatedJwks = JSON.stringify({
      keys: [
        { kid: 'key-new', kty: 'RSA', alg: 'RS256', use: 'sig', d: 'new-d' },
        { kid: 'key-old', kty: 'RSA', alg: 'RS256', use: 'sig', d: 'old-d' },
      ],
    });
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue(rotatedJwks);

    const service = await buildService({ OIDC_KEYS_PATH: keysPath });
    await service.onModuleInit();

    const loaded = service.getJwks();
    expect(loaded.keys).toHaveLength(2);
    // oidc-provider signs with the first key, so newest-first must be preserved.
    expect(loaded.keys[0].kid).toBe('key-new');
    expect(loaded.keys[1].kid).toBe('key-old');
  });

  it('throws on an empty keys array', async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ keys: [] }));

    const service = await buildService({ OIDC_KEYS_PATH: keysPath });

    await expect(service.onModuleInit()).rejects.toThrow(
      'OIDC JWKS file must contain a non-empty "keys" array.',
    );
  });

  it('throws when a key is missing a kid', async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ keys: [{ kty: 'RSA' }] }),
    );

    const service = await buildService({ OIDC_KEYS_PATH: keysPath });

    await expect(service.onModuleInit()).rejects.toThrow(
      'Every OIDC signing key must have a "kid".',
    );
  });

  it('throws on a non-RSA key type', async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ keys: [{ kid: 'k1', kty: 'EC' }] }),
    );

    const service = await buildService({ OIDC_KEYS_PATH: keysPath });

    await expect(service.onModuleInit()).rejects.toThrow(
      /only RSA \(RS256\) keys are supported/,
    );
  });

  it('throws when a key has no private key material (public-only JWK)', async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({
        keys: [{ kid: 'k1', kty: 'RSA', n: 'abc', e: 'AQAB' }],
      }),
    );

    const service = await buildService({ OIDC_KEYS_PATH: keysPath });

    await expect(service.onModuleInit()).rejects.toThrow(
      /must include private key material/,
    );
  });

  it('throws when file exists but is not valid JSON', async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue('not json');

    const service = await buildService({ OIDC_KEYS_PATH: keysPath });

    await expect(service.onModuleInit()).rejects.toThrow(
      'Unable to parse OIDC JWKS file',
    );
  });

  it('fails fast in production when the key file is missing', async () => {
    (existsSync as jest.Mock).mockReturnValue(false);

    const service = await buildService({
      OIDC_KEYS_PATH: keysPath,
      NODE_ENV: 'production',
    });

    await expect(service.onModuleInit()).rejects.toThrow(
      `OIDC signing key file does not exist: ${keysPath}`,
    );
  });

  it('generates and persists a development key when missing outside production', async () => {
    (existsSync as jest.Mock).mockReturnValue(false);
    (generateKeyPair as jest.Mock).mockResolvedValue({
      privateKey: 'fake-private-key',
    });
    (exportJWK as jest.Mock).mockResolvedValue({ kty: 'RSA', n: 'abc' });

    const service = await buildService({
      OIDC_KEYS_PATH: keysPath,
      NODE_ENV: 'development',
    });
    await service.onModuleInit();

    expect(generateKeyPair).toHaveBeenCalledWith(
      'RS256',
      expect.objectContaining({ modulusLength: 2048 }),
    );
    expect(mkdirSync).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalledWith(
      keysPath,
      expect.any(String),
      expect.objectContaining({ mode: 0o600 }),
    );

    const jwks = service.getJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
    });
    expect(typeof jwks.keys[0].kid).toBe('string');
  });

  it('throws when getJwks is called before init', async () => {
    const service = await buildService({});

    expect(() => service.getJwks()).toThrow(
      'OIDC signing keys have not been loaded yet.',
    );
  });

  it('only generates keys once when ensureLoaded is called concurrently', async () => {
    (existsSync as jest.Mock).mockReturnValue(false);
    (generateKeyPair as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ privateKey: 'fake-private-key' }), 10),
        ),
    );
    (exportJWK as jest.Mock).mockResolvedValue({ kty: 'RSA', n: 'abc' });

    const service = await buildService({
      OIDC_KEYS_PATH: keysPath,
      NODE_ENV: 'development',
    });

    const [first, second] = await Promise.all([
      service.ensureLoaded(),
      service.ensureLoaded(),
    ]);

    expect(generateKeyPair).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });
});
