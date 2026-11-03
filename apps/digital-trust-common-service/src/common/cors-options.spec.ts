import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { buildCorsOptions } from './cors-options';

describe('buildCorsOptions', () => {
  it('reflects any origin when CORS_ALLOWED_ORIGINS is "*" outside production', () => {
    const options = buildCorsOptions('*', 'development');

    expect(options.origin).toBe(true);
  });

  it('throws when CORS_ALLOWED_ORIGINS is "*" in production', () => {
    expect(() => buildCorsOptions('*', 'production')).toThrow(
      /not allowed when NODE_ENV=production/,
    );
  });

  it('parses a comma-separated origin list, trimming whitespace', () => {
    const options = buildCorsOptions(
      ' https://app.example.com , https://admin.example.com ',
      'production',
    );

    expect(options.origin).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('throws when the origin list is empty', () => {
    expect(() => buildCorsOptions('  ', 'development')).toThrow(
      /must not be empty/,
    );
  });

  it('throws when an entry is not a valid origin', () => {
    expect(() => buildCorsOptions('not-a-url', 'development')).toThrow(
      /is not a valid origin/,
    );
  });

  it('throws when an entry includes a path', () => {
    expect(() =>
      buildCorsOptions('https://example.com/callback', 'development'),
    ).toThrow(/must be an origin only/);
  });

  it('normalizes a trailing-slash-only path to the bare origin', () => {
    const options = buildCorsOptions('https://app.example.com/', 'production');

    expect(options.origin).toEqual(['https://app.example.com']);
  });

  it('throws when an entry uses a non-http(s) scheme', () => {
    expect(() => buildCorsOptions('file:///', 'development')).toThrow(
      /must use http or https/,
    );
  });

  it('never sets credentials, since auth is Bearer-token only', () => {
    const options = buildCorsOptions('*', 'development');

    expect(options.credentials).toBe(false);
  });

  it('allows the authentication, request metadata, and Prefer headers', () => {
    const options = buildCorsOptions('*', 'development');

    expect(options.allowedHeaders).toEqual([
      'Authorization',
      'Content-Type',
      'X-Request-Id',
      'Idempotency-Key',
      'Prefer',
    ]);
  });

  it('exposes X-Request-Id and the rate-limit headers', () => {
    const options = buildCorsOptions('*', 'development');

    expect(options.exposedHeaders).toEqual([
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Request-Id',
    ]);
  });

  it.each([
    { origin: 'https://app.example.com', allowed: true },
    { origin: 'https://untrusted.example.com', allowed: false },
  ])(
    'handles long-poll preflight from $origin',
    async ({ origin, allowed }) => {
      const module = await Test.createTestingModule({}).compile();
      const app: INestApplication<Server> = module.createNestApplication();
      app.enableCors(buildCorsOptions('https://app.example.com', 'production'));

      try {
        await app.init();
        const response = await request(app.getHttpServer())
          .options('/api/v1/tenants/tenant/operations/batch/items')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'GET')
          .set('Access-Control-Request-Headers', 'authorization,prefer')
          .expect(204);

        if (allowed) {
          expect(response.headers['access-control-allow-origin']).toBe(origin);
          const headers = response.headers['access-control-allow-headers'];
          expect(
            headers
              .toLowerCase()
              .split(',')
              .map((header) => header.trim()),
          ).toEqual(expect.arrayContaining(['authorization', 'prefer']));
        } else {
          expect(
            response.headers['access-control-allow-origin'],
          ).toBeUndefined();
        }
        expect(
          response.headers['access-control-allow-credentials'],
        ).toBeUndefined();
      } finally {
        await app.close();
      }
    },
  );
});
