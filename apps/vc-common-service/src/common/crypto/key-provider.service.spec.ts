import { existsSync, readFileSync } from 'fs';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { KeyProviderService } from './key-provider.service';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

describe('KeyProviderService', () => {
  let service: KeyProviderService;
  let configService: jest.Mocked<ConfigService>;

  const configPath = '/tmp/encryption-keys.json';

  const validConfig = JSON.stringify({
    currentVersion: 2,
    keys: {
      '1': '1111111111111111111111111111111111111111111111111111111111111111',
      '2': '2222222222222222222222222222222222222222222222222222222222222222',
    },
  });

  beforeEach(async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue(validConfig);

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'CONNECTOR_ENCRYPTION_KEYS_PATH') {
          return configPath;
        }

        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyProviderService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get(KeyProviderService);
    configService = module.get(ConfigService);

    service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('configuration loading', () => {
    it('should load the configured keys', () => {
      expect(service.getCurrentVersion()).toBe(2);

      expect(service.getCurrentKey().version).toBe(2);
      expect(service.getKey(1).version).toBe(1);
    });

    it('should read the configured file path', () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configService.get).toHaveBeenCalledWith(
        'CONNECTOR_ENCRYPTION_KEYS_PATH',
      );

      expect(existsSync).toHaveBeenCalledWith(configPath);
      expect(readFileSync).toHaveBeenCalledWith(configPath, 'utf8');
    });
  });

  describe('public api', () => {
    it('should return the current key', () => {
      const key = service.getCurrentKey();

      expect(key.version).toBe(2);
      expect(key.key.length).toBe(32);
    });

    it('should return a specific key version', () => {
      const key = service.getKey(1);

      expect(key.version).toBe(1);
      expect(key.key.length).toBe(32);
    });

    it('should identify the current key version', () => {
      expect(service.requiresRotation(2)).toBe(false);
      expect(service.requiresRotation(1)).toBe(true);
    });

    it('should return the current version', () => {
      expect(service.getCurrentVersion()).toBe(2);
    });

    it('should throw when requesting an unknown key version', () => {
      expect(() => service.getKey(999)).toThrow();
    });
  });

  describe('validation', () => {
    it('should throw if the config path is missing', () => {
      configService.get.mockReturnValue(undefined);

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        'CONNECTOR_ENCRYPTION_KEYS_PATH is not configured.',
      );
    });

    it('should throw if the file does not exist', () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        `Encryption key file does not exist: ${configPath}`,
      );
    });

    it('should throw if the file contains invalid json', () => {
      (readFileSync as jest.Mock).mockReturnValue('{');

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        'Unable to load encryption key configuration:',
      );
    });

    it('should throw if currentVersion is missing', () => {
      (readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          keys: {
            '1': '1111111111111111111111111111111111111111111111111111111111111111',
          },
        }),
      );

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        'Encryption configuration requires a numeric currentVersion.',
      );
    });

    it('should throw if keys is missing', () => {
      (readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          currentVersion: 1,
        }),
      );

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        'Encryption configuration requires a keys object.',
      );
    });

    it('should throw if keys is not an object', () => {
      (readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          currentVersion: 1,
          keys: 'invalid',
        }),
      );

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        'Encryption configuration requires a keys object.',
      );
    });

    it('should throw if no keys are configured', () => {
      (readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          currentVersion: 1,
          keys: {},
        }),
      );

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        'Encryption configuration contains no keys.',
      );
    });

    it('should throw if the current version is not present', () => {
      (readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          currentVersion: 2,
          keys: {
            '1': '1111111111111111111111111111111111111111111111111111111111111111',
          },
        }),
      );

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        'Current encryption key version 2 is not defined.',
      );
    });

    it('should throw if a key is not valid hexadecimal', () => {
      (readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          currentVersion: 1,
          keys: {
            '1': 'not-a-hex-string',
          },
        }),
      );

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        'Encryption key version 1 must be exactly 32 bytes (256 bits).',
      );
    });

    it('should throw if a key is not 32 bytes', () => {
      (readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          currentVersion: 1,
          keys: {
            '1': 'abcd',
          },
        }),
      );

      const fresh = new KeyProviderService(configService);

      expect(() => fresh.onModuleInit()).toThrow(
        'Encryption key version 1 must be exactly 32 bytes (256 bits).',
      );
    });
  });
});
