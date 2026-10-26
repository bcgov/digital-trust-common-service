import { BadRequestException } from '@nestjs/common';

import { normalizeRegistrationMetadata } from './registration-metadata';

describe('normalizeRegistrationMetadata', () => {
  it('applies defaults and returns the normalized reserved metadata', () => {
    expect(normalizeRegistrationMetadata({ issuer: 'DMV' })).toEqual({
      metadata: {
        issuer: 'DMV',
        tag: 'default',
        revocation: { enabled: true },
      },
      options: { tag: 'default', revocation: { enabled: true } },
    });
  });

  it('uses supplied reserved settings while preserving arbitrary annotations', () => {
    expect(
      normalizeRegistrationMetadata({
        tag: 'employee',
        revocation: { enabled: false },
        issuer: 'DMV',
      }),
    ).toEqual({
      metadata: {
        tag: 'employee',
        revocation: { enabled: false },
        issuer: 'DMV',
      },
      options: { tag: 'employee', revocation: { enabled: false } },
    });
  });

  it('preserves normalized settings when replacing metadata annotations', () => {
    expect(
      normalizeRegistrationMetadata(
        { issuer: 'New issuer' },
        { tag: 'employee', revocation: { enabled: false } },
      ),
    ).toEqual({
      metadata: {
        issuer: 'New issuer',
        tag: 'employee',
        revocation: { enabled: false },
      },
      options: { tag: 'employee', revocation: { enabled: false } },
    });
  });

  it.each([
    { tag: '' },
    { tag: 'x'.repeat(101) },
    { tag: null },
    { revocation: null },
    { revocation: {} },
    { revocation: { enabled: 'true' } },
    { revocation: { enabled: true, method: 'other' } },
  ])('rejects malformed reserved metadata: %j', (metadata) => {
    expect(() => normalizeRegistrationMetadata(metadata)).toThrow(
      BadRequestException,
    );
  });
});
