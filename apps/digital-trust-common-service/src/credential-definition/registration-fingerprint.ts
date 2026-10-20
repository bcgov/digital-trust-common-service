import { createHash } from 'crypto';

import type { DefinitionOptions } from '@app/credential-ports';
import { BadRequestException } from '@nestjs/common';
import canonicalize from 'canonicalize';

interface RegistrationIntent {
  tenantId: string;
  connectorId: string;
  issuerId: string;
  format: string;
  schema: { id?: string; definition: Record<string, unknown> };
  options: DefinitionOptions;
}

export function registrationFingerprints(
  intent: RegistrationIntent,
  name: string,
  metadata?: Record<string, unknown> | null,
): { request: string; artifact: string } {
  const attributes = intent.schema.definition.attr_names;
  const artifact = {
    ...intent,
    schema: {
      id: intent.schema.id ?? null,
      definition: {
        ...intent.schema.definition,
        ...(Array.isArray(attributes) &&
        attributes.every(
          (attribute): attribute is string => typeof attribute === 'string',
        )
          ? { attr_names: [...attributes].sort() }
          : {}),
      },
    },
  };
  return {
    artifact: digest({ domain: 'dtcs:credential-artifact:v1', ...artifact }),
    request: digest({
      domain: 'dtcs:credential-registration-request:v1',
      ...artifact,
      name,
      metadata: metadata ?? null,
    }),
  };
}

function digest(value: Record<string, unknown>): string {
  let canonical: string | undefined;
  try {
    canonical = canonicalize(value);
  } catch {
    throw new BadRequestException(
      'Registration content must be valid JCS JSON',
    );
  }
  if (canonical === undefined) {
    throw new BadRequestException(
      'Registration content must be valid JCS JSON',
    );
  }
  const hash = createHash('sha256').update(canonical, 'utf8').digest();
  // Multihash: sha2-256 (0x12), 32 bytes (0x20); multibase: base64url (u).
  return `u${Buffer.concat([Buffer.from([0x12, 0x20]), hash]).toString('base64url')}`;
}
