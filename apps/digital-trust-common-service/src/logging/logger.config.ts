import { ConfigService } from '@nestjs/config';
import {
  nativeLoggerOptions,
  type Params as PinoLoggerModuleParams,
} from 'nestjs-pino';
import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type LoggerOptions,
} from 'pino';
import type { PrettyOptions } from 'pino-pretty';

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
// depth 3); no call site passes an object to the logger. Depth grows once we log
// payloads we did not shape — upstream error bodies from an adapter, or domain
// events carrying structured detail. Revisit then, against real shapes. The
// primary defence for foreign payloads is not logging them at all: see the
// redaction rules in docs/ARCHITECTURE.md.
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

// nestjs-pino's native preset renames pino's levels to match Nest's console
// logger, so the emitted `level` is a string such as `log` or `verbose` rather
// than a number. pino-pretty maps levels by number, so it renders both as
// USERLVL; the prettifier below colours the label itself instead.
const PRETTY_LEVEL_COLOURS = new Map<
  string,
  'blue' | 'gray' | 'green' | 'magenta' | 'red' | 'yellow'
>([
  ['verbose', 'gray'],
  ['debug', 'blue'],
  ['log', 'green'],
  ['warn', 'yellow'],
  ['error', 'red'],
  ['fatal', 'magenta'],
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
  const logger = createLogger(pinoOptions, configService, stream);

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

function createLogger(
  pinoOptions: LoggerOptions,
  configService: ConfigService,
  stream?: DestinationStream,
): pino.Logger {
  const jsonLogger = (): pino.Logger =>
    stream ? pino(pinoOptions, stream) : pino(pinoOptions);

  if (!isPrettyRequested(configService)) {
    return jsonLogger();
  }

  // `stream` is the destination; LOG_PRETTY only changes how records are
  // rendered onto it. Passing it through keeps the two concerns separate and
  // lets tests capture prettified bytes.
  const prettyStream = createPrettyStream(stream);

  if (prettyStream === undefined) {
    const logger = jsonLogger();
    logger.warn(
      'LOG_PRETTY is enabled but pino-pretty is not installed; falling back to JSON output',
    );

    return logger;
  }

  return pino(pinoOptions, prettyStream);
}

function isPrettyRequested(configService: ConfigService): boolean {
  return (
    configService.get<string>('LOG_PRETTY')?.trim().toLowerCase() === 'true'
  );
}

// pino-pretty is a devDependency, so the production image — built with
// `npm ci --omit=dev` — does not carry it. Loading it lazily means
// LOG_PRETTY=true in a deployed environment degrades to JSON with a warning
// instead of killing the process at boot.
function createPrettyStream(
  destination?: DestinationStream,
): DestinationStream | undefined {
  const prettyOptions: PrettyOptions = {
    customPrettifiers: {
      level: (value, _key, _log, extras) => {
        if (typeof value !== 'string') {
          return extras.label;
        }

        const label = value.toUpperCase();
        const colour = PRETTY_LEVEL_COLOURS.get(value);

        return colour === undefined ? label : extras.colors[colour](label);
      },
    },
    // `context` and `message` are rendered by messageFormat; `pid` and
    // `service` are fixed for a local process and only add noise. Everything
    // else still prints, so redacted values stay visible as `[Redacted]`.
    ignore: 'pid,service,context',
    levelKey: 'level',
    messageFormat: '{if context}[{context}] {end}{message}',
    messageKey: 'message',
    timestampKey: 'timestamp',
    translateTime: 'SYS:HH:MM:ss.l',
    ...(destination === undefined ? {} : { destination }),
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prettyFactory = require('pino-pretty') as (
      options: PrettyOptions,
    ) => DestinationStream;

    return prettyFactory(prettyOptions);
  } catch {
    return undefined;
  }
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
