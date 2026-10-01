export type CorsOptions = {
  origin: boolean | string[];
  credentials: false;
  allowedHeaders: string[];
  exposedHeaders: string[];
};

const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Request-Id',
  'Idempotency-Key',
];

const EXPOSED_HEADERS = [
  'X-Request-Id',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
];

/**
 * Builds the app's CORS options from CORS_ALLOWED_ORIGINS. Credentials are
 * always off — auth is Bearer-token only, never a cross-origin cookie — so
 * "*" does not carry the usual reflect-any-origin-with-credentials risk, but
 * it is still refused outside development since it is far more likely a
 * forgotten override than deliberate intent for a deployed environment.
 */
export function buildCorsOptions(
  rawOrigins: string,
  nodeEnv: string | undefined,
): CorsOptions {
  return {
    origin: parseAllowedOrigins(rawOrigins, nodeEnv),
    credentials: false,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
  };
}

function parseAllowedOrigins(
  rawOrigins: string,
  nodeEnv: string | undefined,
): boolean | string[] {
  const trimmed = rawOrigins.trim();

  if (trimmed === '*') {
    if (nodeEnv === 'production') {
      throw new Error(
        'CORS_ALLOWED_ORIGINS=* is not allowed when NODE_ENV=production; ' +
          'set an explicit comma-separated origin list.',
      );
    }

    return true;
  }

  const origins = trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS must not be empty.');
  }

  for (const origin of origins) {
    assertValidOrigin(origin);
  }

  return origins;
}

function assertValidOrigin(origin: string): void {
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry '${origin}' is not a valid origin.`,
    );
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry '${origin}' must be an origin only ` +
        '(scheme + host + port, no path).',
    );
  }
}
