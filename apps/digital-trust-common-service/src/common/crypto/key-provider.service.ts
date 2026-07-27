import { existsSync, readFileSync } from 'fs';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EncryptionKey {
  version: number;
  key: Buffer;
}

interface EncryptionKeyConfig {
  currentVersion: number;
  keys: Record<string, string>;
}

@Injectable()
export class KeyProviderService implements OnModuleInit {
  private readonly logger = new Logger(KeyProviderService.name);

  private readonly keys = new Map<number, Buffer>();

  private currentVersion!: number;

  public constructor(private readonly configService: ConfigService) {}

  public onModuleInit(): void {
    this.loadKeys();

    this.logger.log(
      `Loaded encryption keys. Current version: ${this.currentVersion}`,
    );
  }

  /**
   * Returns the key used for new encryptions.
   */
  public getCurrentKey(): EncryptionKey {
    const key = this.keys.get(this.currentVersion);

    if (!key) {
      throw new Error(
        `Current encryption key version ${this.currentVersion} is not available.`,
      );
    }

    return {
      version: this.currentVersion,
      key,
    };
  }

  /**
   * Returns a specific encryption key version.
   *
   * Used when decrypting existing records.
   */
  public getKey(version: number): EncryptionKey {
    const key = this.keys.get(version);

    if (!key) {
      throw new Error(`Encryption key version ${version} is not configured.`);
    }

    return {
      version,
      key,
    };
  }

  /**
   * Determines if a credential encrypted with this version
   * should be re-encrypted with the latest key.
   */
  public requiresRotation(version: number): boolean {
    return version !== this.currentVersion;
  }

  /**
   * Returns the active key version.
   */
  public getCurrentVersion(): number {
    return this.currentVersion;
  }

  private loadKeys(): void {
    const configPath = this.configService.get<string>(
      'CONNECTOR_ENCRYPTION_KEYS_PATH',
    );

    if (!configPath) {
      throw new Error('CONNECTOR_ENCRYPTION_KEYS_PATH is not configured.');
    }

    if (!existsSync(configPath)) {
      throw new Error(`Encryption key file does not exist: ${configPath}`);
    }

    let config: EncryptionKeyConfig;

    try {
      const contents = readFileSync(configPath, 'utf8');

      config = JSON.parse(contents) as EncryptionKeyConfig;
    } catch (error) {
      throw new Error(
        `Unable to load encryption key configuration: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    this.validateConfig(config);

    this.currentVersion = config.currentVersion;

    for (const [version, encodedKey] of Object.entries(config.keys)) {
      const numericVersion = Number(version);

      this.keys.set(numericVersion, this.decodeKey(encodedKey, numericVersion));
    }

    if (!this.keys.has(this.currentVersion)) {
      throw new Error(
        `Current encryption key version ${this.currentVersion} is not defined.`,
      );
    }
  }

  private validateConfig(config: EncryptionKeyConfig): void {
    if (!config.currentVersion || typeof config.currentVersion !== 'number') {
      throw new Error(
        'Encryption configuration requires a numeric currentVersion.',
      );
    }

    if (!config.keys || typeof config.keys !== 'object') {
      throw new Error('Encryption configuration requires a keys object.');
    }

    if (Object.keys(config.keys).length === 0) {
      throw new Error('Encryption configuration contains no keys.');
    }
  }

  private decodeKey(value: string, version: number): Buffer {
    let key: Buffer;

    try {
      key = Buffer.from(value, 'hex');
    } catch {
      throw new Error(
        `Encryption key version ${version} is not valid hexadecimal.`,
      );
    }

    if (key.length !== 32) {
      throw new Error(
        `Encryption key version ${version} must be exactly 32 bytes (256 bits).`,
      );
    }

    return key;
  }
}
