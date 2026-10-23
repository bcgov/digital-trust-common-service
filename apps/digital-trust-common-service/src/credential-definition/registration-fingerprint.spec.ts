import { createHash } from 'crypto';

import { BadRequestException } from '@nestjs/common';
import canonicalize from 'canonicalize';

import { registrationFingerprints } from './registration-fingerprint';

describe('registrationFingerprints', () => {
  const intent = {
    tenantId: 'tenant-1',
    connectorId: 'connector-1',
    issuerId: 'did:indy:issuer',
    format: 'anoncreds',
    schema: {
      definition: {
        schema_name: 'employee',
        schema_version: '1.0',
        attr_names: ['name', 'id'],
      },
    },
    options: { tag: 'default', revocation: { enabled: true } },
  };

  it('encodes a JCS SHA-256 multihash using unpadded base64url multibase', () => {
    const result = registrationFingerprints(intent, 'Employee');
    expect(result.artifact).toMatch(/^u[A-Za-z0-9_-]{46}$/);
    expect(result.request).toMatch(/^u[A-Za-z0-9_-]{46}$/);
    const decoded = Buffer.from(result.artifact.slice(1), 'base64url');
    expect(decoded.subarray(0, 2)).toEqual(Buffer.from([0x12, 0x20]));
    const expected = canonicalize({
      domain: 'dtcs:credential-artifact:v1',
      ...intent,
      schema: {
        id: null,
        definition: { ...intent.schema.definition, attr_names: ['id', 'name'] },
      },
    })!;
    expect(decoded.subarray(2)).toEqual(
      createHash('sha256').update(expected, 'utf8').digest(),
    );
    expect(result.request).not.toBe(result.artifact);
  });

  it('ignores object ordering and schema attribute order without mutating input', () => {
    const first = registrationFingerprints(intent, 'Employee', { b: 2, a: 1 });
    const reordered = {
      ...intent,
      schema: {
        definition: {
          attr_names: ['id', 'name'],
          schema_version: '1.0',
          schema_name: 'employee',
        },
      },
    };
    expect(
      registrationFingerprints(reordered, 'Employee', { a: 1, b: 2 }),
    ).toEqual(first);
    expect(intent.schema.definition.attr_names).toEqual(['name', 'id']);
  });

  it('excludes local name and metadata only from the artifact fingerprint', () => {
    const first = registrationFingerprints(intent, 'Employee', {
      labels: ['a', 'b'],
    });
    const second = registrationFingerprints(intent, 'Other', {
      labels: ['b', 'a'],
    });
    expect(first.artifact).toBe(second.artifact);
    expect(first.request).not.toBe(second.request);
    expect(registrationFingerprints(intent, 'Employee').request).toBe(
      registrationFingerprints(intent, 'Employee', null).request,
    );
    expect(
      registrationFingerprints(intent, 'Employee', { labels: ['b', 'a'] })
        .request,
    ).not.toBe(first.request);
  });

  it.each([
    { tenantId: 'tenant-2' },
    { connectorId: 'connector-2' },
    { issuerId: 'did:indy:other' },
    { options: { tag: 'other', revocation: { enabled: true } } },
    { options: { tag: 'default', revocation: { enabled: false } } },
    { schema: { ...intent.schema, id: 'published-schema' } },
    {
      schema: {
        definition: { ...intent.schema.definition, attr_names: ['new'] },
      },
    },
    {
      schema: {
        definition: { ...intent.schema.definition, schema_version: '2.0' },
      },
    },
  ])('separates changed registration identity %j', (change) => {
    expect(
      registrationFingerprints({ ...intent, ...change }, 'Employee').artifact,
    ).not.toBe(registrationFingerprints(intent, 'Employee').artifact);
  });

  it.each([NaN, Infinity, '\uD800'])(
    'rejects content outside JCS: %s',
    (value) => {
      expect(() =>
        registrationFingerprints(intent, 'Employee', { value }),
      ).toThrow(BadRequestException);
    },
  );

  it('rejects content whose canonical representation is undefined', () => {
    const unserializableIntent = {
      ...intent,
      toJSON: () => undefined,
    };

    expect(() =>
      registrationFingerprints(unserializableIntent, 'Employee'),
    ).toThrow(BadRequestException);
  });
});
