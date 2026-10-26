import type { DefinitionOptions } from '@app/credential-ports';
import { BadRequestException } from '@nestjs/common';

export interface NormalizedRegistrationMetadata {
  metadata: Record<string, unknown>;
  options: DefinitionOptions;
}

const DEFAULT_REGISTRATION_OPTIONS: DefinitionOptions = {
  tag: 'default',
  revocation: { enabled: true },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeRegistrationMetadata(
  metadata: Record<string, unknown> | null | undefined,
  defaults: DefinitionOptions = DEFAULT_REGISTRATION_OPTIONS,
): NormalizedRegistrationMetadata {
  const annotations = metadata ?? {};
  const tag = annotations.tag ?? defaults.tag;
  const revocation = annotations.revocation;

  if (
    typeof tag !== 'string' ||
    tag.length < 1 ||
    tag.length > 100 ||
    (Object.hasOwn(annotations, 'tag') && annotations.tag === null)
  ) {
    throw new BadRequestException(
      'metadata.tag must be a string of 1–100 characters',
    );
  }

  let revocationEnabled = defaults.revocation.enabled;
  if (revocation !== undefined) {
    if (
      !isRecord(revocation) ||
      !Object.hasOwn(revocation, 'enabled') ||
      typeof revocation.enabled !== 'boolean' ||
      Object.keys(revocation).some((key) => key !== 'enabled')
    ) {
      throw new BadRequestException(
        'metadata.revocation must contain only a boolean enabled property',
      );
    }
    revocationEnabled = revocation.enabled;
  }

  const options: DefinitionOptions = {
    tag,
    revocation: { enabled: revocationEnabled },
  };
  return {
    metadata: {
      ...annotations,
      tag: options.tag,
      revocation: options.revocation,
    },
    options,
  };
}
