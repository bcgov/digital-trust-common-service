import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';

import { KeyProviderService } from './key-provider.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptionResult {
  ciphertext: Buffer;
  keyVersion: number;
}

@Injectable()
export class EncryptionService {
  public constructor(private readonly keyProvider: KeyProviderService) {}

  /**
   * Encrypts any JSON-serializable object.
   *
   * Stored format:
   * [12-byte IV][16-byte Auth Tag][Ciphertext]
   */
  public encrypt(value: unknown): EncryptionResult {
    const { version, key } = this.keyProvider.getCurrentKey();

    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);

    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');

    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return {
      ciphertext: Buffer.concat([iv, authTag, encrypted]),
      keyVersion: version,
    };
  }

  /**
   * Decrypts an encrypted payload.
   */
  public decrypt<T>(ciphertext: Buffer, keyVersion: number): T {
    const { key } = this.keyProvider.getKey(keyVersion);

    if (ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted payload.');
    }

    const iv = ciphertext.subarray(0, IV_LENGTH);

    const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);

    const encrypted = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8')) as T;
  }

  /**
   * Returns true if the supplied key version is not the current version.
   */
  public requiresRotation(keyVersion: number): boolean {
    return keyVersion !== this.keyProvider.getCurrentKey().version;
  }
}
