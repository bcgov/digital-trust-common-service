import { ConfigService } from '@nestjs/config';
import {
  nativeLoggerOptions,
  type Params as PinoLoggerModuleParams,
} from 'nestjs-pino';
import pino, { type DestinationStream, type LevelWithSilent } from 'pino';

const DEFAULT_LOG_LEVEL: LevelWithSilent = 'info';
const SERVICE_NAME = 'digital-trust-common-service';
const REDACTION_CENSOR = '[Redacted]';
// Pino's redact wildcards match one level each, so each key is enumerated at
// every depth we want covered: the bare key plus this many `*.` prefixes, i.e.
// depths 1 through MAX_REDACTION_DEPTH + 1. A secret nested deeper than that is
// emitted in clear — the failure is silent, so treat this as a backstop rather
// than a coverage plan.
//
// Today the deepest thing logged is the serialized request (`req.headers.cookie`,
// depth 3); no call site passes an object to the logger. Depth grows when we
// start logging payloads we did not shape — upstream error bodies once the
// Traction adapter lands (CT-01), and domain events in OB-08. Revisit then,
// against real shapes. The primary defence for foreign payloads is not logging
// them: see the redaction rules in docs/ARCHITECTURE.md.
const MAX_REDACTION_DEPTH = 6;

const VALID_LOG_LEVELS = new Set<LevelWithSilent>([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);

const SENSITIVE_LOG_KEYS = [
  'authorization',
  'Authorization',
  'proxy-authorization',
  // Request-scoped lines carry the serialized request, so `req.headers.cookie`
  // reaches the log. This service issues oidc-provider session cookies.
  'cookie',
  'Cookie',
  'set-cookie',
  'Set-Cookie',
  'bearerToken',
  'bearer_token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'token',
  'clientSecret',
  'client_secret',
  'clientSecretHash',
  'client_secret_hash',
  'clientAssertion',
  'client_assertion',
  'password',
  'apiKey',
  'api_key',
  'api-key',
  'x-api-key',
  'X-API-Key',
  'privateKey',
  'private_key',
  'privateKeyPem',
  'private_key_pem',
  'credentialSubject',
  'credential_subject',
  'claims',
  'claimValues',
  'claim_values',
] as const;

export function createLoggerModuleParams(
  configService: ConfigService,
  stream?: DestinationStream,
): PinoLoggerModuleParams {
  const { level, configuredLevel } = getLogLevel(configService);
  const pinoOptions = {
    ...nativeLoggerOptions,
    autoLogging: false,
    base: {
      pid: process.pid,
      service: SERVICE_NAME,
    },
    level,
    redact: {
      censor: REDACTION_CENSOR,
      paths: buildRedactPaths(SENSITIVE_LOG_KEYS),
    },
  };
  const logger = stream ? pino(pinoOptions, stream) : pino(pinoOptions);

  if (configuredLevel !== undefined && configuredLevel !== level) {
    logger.warn(
      { configuredLogLevel: configuredLevel, fallbackLogLevel: level },
      'Invalid LOG_LEVEL configured; falling back to info',
    );
  }

  return {
    pinoHttp: {
      ...pinoOptions,
      logger,
    },
  };
}

function getLogLevel(configService: ConfigService): {
  configuredLevel?: string;
  level: LevelWithSilent;
} {
  const configuredLevel = configService.get<string>('LOG_LEVEL');
  const normalizedLevel = configuredLevel?.trim().toLowerCase();

  if (normalizedLevel === undefined || normalizedLevel === '') {
    return { level: DEFAULT_LOG_LEVEL };
  }

  if (VALID_LOG_LEVELS.has(normalizedLevel as LevelWithSilent)) {
    return {
      configuredLevel: normalizedLevel,
      level: normalizedLevel as LevelWithSilent,
    };
  }

  return { configuredLevel, level: DEFAULT_LOG_LEVEL };
}

function buildRedactPaths(keys: readonly string[]): string[] {
  return keys.flatMap((key) => [
    key,
    ...Array.from(
      { length: MAX_REDACTION_DEPTH },
      (_, depth) => `${'*.'.repeat(depth + 1)}${key}`,
    ),
  ]);
}
