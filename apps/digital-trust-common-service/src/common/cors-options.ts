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
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'X-Request-Id',
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

  return origins.map((origin) => normalizeOrigin(origin));
}

function normalizeOrigin(origin: string): string {
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry '${origin}' is not a valid origin.`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry '${origin}' must use http or https.`,
    );
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry '${origin}' must be an origin only ` +
        '(scheme + host + port, no path).',
    );
  }

  // Normalizes a trailing-slash-only path ("https://a.com/") to the exact
  // string the browser's Origin header uses ("https://a.com"), which `cors`'s
  // array-equality check otherwise never matches.
  return url.origin;
}
