import { randomBytes } from 'crypto';

import { Test, TestingModule } from '@nestjs/testing';

import { EncryptionService } from './encryption.service';
import { KeyProviderService } from './key-provider.service';

describe('EncryptionService', () => {
  let service: EncryptionService;
  let keyProvider: KeyProviderService;

  const KEY_V1 = randomBytes(32);
  const KEY_V2 = randomBytes(32);

  beforeEach(async () => {
    const mockKeyProvider = {
      getCurrentKey: jest.fn(() => ({
        version: 1,
        key: KEY_V1,
      })),
      getKey: jest.fn(() => ({
        version: 1,
        key: KEY_V1,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: KeyProviderService,
          useValue: mockKeyProvider,
        },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
    keyProvider = module.get<KeyProviderService>(KeyProviderService);
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt a value correctly', () => {
      const testValue = { message: 'hello', count: 42 };

      const encrypted = service.encrypt(testValue);

      const decrypted = service.decrypt(
        encrypted.ciphertext,
        encrypted.keyVersion,
      );

      expect(decrypted).toEqual(testValue);
    });

    it('should generate different ciphertext for the same plaintext', () => {
      const testValue = { message: 'hello' };

      const encrypted1 = service.encrypt(testValue);
      const encrypted2 = service.encrypt(testValue);

      expect(encrypted1.ciphertext.equals(encrypted2.ciphertext)).toBe(false);
    });

    it('should throw if the payload is too small', () => {
      expect(() => service.decrypt(Buffer.alloc(5), 1)).toThrow();
    });
  });

  describe('authentication', () => {
    it('should throw when decrypted with the wrong key', () => {
      const encrypted = service.encrypt({
        message: 'secret',
      });

      jest.spyOn(keyProvider, 'getKey').mockReturnValue({
        version: 1,
        key: KEY_V2,
      });

      expect(() => service.decrypt(encrypted.ciphertext, 1)).toThrow();
    });

    it('should throw if the ciphertext has been modified', () => {
      const encrypted = service.encrypt({
        message: 'secret',
      });

      const tampered = Buffer.from(encrypted.ciphertext);

      tampered[tampered.length - 1] ^= 0xff;

      expect(() => service.decrypt(tampered, 1)).toThrow();
    });

    it('should throw if the auth tag has been modified', () => {
      const encrypted = service.encrypt({
        message: 'secret',
      });

      const tampered = Buffer.from(encrypted.ciphertext);

      // Auth tag begins after the 12-byte IV.
      tampered[12] ^= 0xff;

      expect(() => service.decrypt(tampered, 1)).toThrow();
    });

    it('should throw if the IV has been modified', () => {
      const encrypted = service.encrypt({
        message: 'secret',
      });

      const tampered = Buffer.from(encrypted.ciphertext);

      tampered[0] ^= 0xff;

      expect(() => service.decrypt(tampered, 1)).toThrow();
    });
  });

  describe('requiresRotation', () => {
    it('should return false for the current key version', () => {
      jest.spyOn(keyProvider, 'getCurrentKey').mockReturnValue({
        version: 2,
        key: KEY_V1,
      });

      expect(service.requiresRotation(2)).toBe(false);
    });

    it('should return true for an older key version', () => {
      jest.spyOn(keyProvider, 'getCurrentKey').mockReturnValue({
        version: 2,
        key: KEY_V1,
      });

      expect(service.requiresRotation(1)).toBe(true);
    });
  });

  describe('decryptWithKey', () => {
    it('should decrypt a value with the correct key', () => {
      const testValue = { message: 'hello', count: 42 };

      const encrypted = service.encrypt(testValue);

      const decrypted = service.decryptWithKey<typeof testValue>(
        encrypted.ciphertext,
        KEY_V1,
      );

      expect(decrypted).toEqual(testValue);
    });

    it('should throw if the payload is too small', () => {
      expect(() => service.decryptWithKey(Buffer.alloc(5), KEY_V1)).toThrow(
        'Invalid encrypted payload.',
      );
    });

    it('should throw when decrypted with the wrong key', () => {
      const encrypted = service.encrypt({
        message: 'secret',
      });

      expect(() =>
        service.decryptWithKey(encrypted.ciphertext, KEY_V2),
      ).toThrow();
    });

    it('should throw if the ciphertext has been modified', () => {
      const encrypted = service.encrypt({
        message: 'secret',
      });

      const tampered = Buffer.from(encrypted.ciphertext);

      tampered[tampered.length - 1] ^= 0xff;

      expect(() => service.decryptWithKey(tampered, KEY_V1)).toThrow();
    });

    it('should throw if the auth tag has been modified', () => {
      const encrypted = service.encrypt({
        message: 'secret',
      });

      const tampered = Buffer.from(encrypted.ciphertext);

      // Auth tag begins after the 12-byte IV.
      tampered[12] ^= 0xff;

      expect(() => service.decryptWithKey(tampered, KEY_V1)).toThrow();
    });

    it('should throw if the IV has been modified', () => {
      const encrypted = service.encrypt({
        message: 'secret',
      });

      const tampered = Buffer.from(encrypted.ciphertext);

      tampered[0] ^= 0xff;

      expect(() => service.decryptWithKey(tampered, KEY_V1)).toThrow();
    });

    it('should handle different data types', () => {
      const testCases = [
        { value: 'string', expected: 'string' },
        { value: 123, expected: 123 },
        { value: true, expected: true },
        { value: [1, 2, 3], expected: [1, 2, 3] },
        {
          value: { nested: { object: 'data' } },
          expected: { nested: { object: 'data' } },
        },
      ];

      testCases.forEach(({ value, expected }) => {
        const encrypted = service.encrypt(value);
        const decrypted = service.decryptWithKey(encrypted.ciphertext, KEY_V1);
        expect(decrypted).toEqual(expected);
      });
    });
  });
});
