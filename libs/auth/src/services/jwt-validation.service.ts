import { OidcConfigService } from '@app/oidc';
import { Injectable } from '@nestjs/common';
import { importJWK, jwtVerify, type JWTPayload } from 'jose';

import { AuthenticationRequiredException } from '../exceptions/authentication-required.exception';
import type { AuthContext } from '../interfaces/auth-context.interface';

import { JwksCacheService } from './jwks-cache.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_SUB_PREFIX = 'client:';

export interface VerifyJwtOptions {
  issuer: string;
  audience: string;
}

/**
 * Shared JWT verification used by {@link JwtValidationService} and tests.
 * Validates RS256 signature, expiration, issuer, and audience against a
 * caller-supplied JWKS key resolver.
 */
export async function verifyAccessToken(
  token: string,
  resolveKey: (kid: string) => Promise<Record<string, unknown>>,
  options: VerifyJwtOptions,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(
    token,
    async (protectedHeader) => {
      if (protectedHeader.alg !== 'RS256') {
        throw new AuthenticationRequiredException(
          'invalid_token',
          'Unsupported signing algorithm',
        );
      }

      const kid = protectedHeader.kid;

      if (!kid) {
        throw new AuthenticationRequiredException(
          'invalid_token',
          'Token header missing kid',
        );
      }

      const jwk = await resolveKey(kid);

      return importJWK(jwk, 'RS256');
    },
    {
      issuer: options.issuer,
      audience: options.audience,
    },
  );

  return payload;
}

export function normalizeAuthPayload(payload: JWTPayload): AuthContext {
  const sub = String(payload.sub ?? '');

  if (!sub) {
    throw new AuthenticationRequiredException(
      'invalid_token',
      'Token is missing sub claim',
    );
  }

  const explicitClientId = readOptionalString(payload.client_id);
  const tokenType = resolveTokenType(sub, explicitClientId);
  const clientId =
    tokenType === 'client'
      ? (explicitClientId ?? deriveClientIdFromSub(sub))
      : null;
  const scope = readScope(payload.scope);
  const roles = readRoles(payload.roles);

  return {
    sub,
    tokenType,
    clientId,
    tenantId: readOptionalString(payload.tenant_id),
    roles,
    scope,
    scopes: scope.length > 0 ? scope.split(/\s+/).filter(Boolean) : [],
    iss: String(payload.iss ?? ''),
    aud: payload.aud ?? '',
    exp: Number(payload.exp ?? 0),
    iat: Number(payload.iat ?? 0),
  };
}

function resolveTokenType(
  sub: string,
  explicitClientId: string | null,
): AuthContext['tokenType'] {
  if (sub.startsWith(CLIENT_SUB_PREFIX)) {
    return 'client';
  }

  if (UUID_PATTERN.test(sub)) {
    return 'user';
  }

  if (explicitClientId) {
    return 'client';
  }

  return 'client';
}

function deriveClientIdFromSub(sub: string): string {
  if (sub.startsWith(CLIENT_SUB_PREFIX)) {
    return sub.slice(CLIENT_SUB_PREFIX.length);
  }

  return sub;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readScope(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .join(' ');
  }

  return '';
}

function readRoles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function extractBearerToken(
  authorizationHeader: string | undefined,
): string {
  if (!authorizationHeader) {
    throw new AuthenticationRequiredException(
      'invalid_request',
      'Authorization header is required',
    );
  }

  const [scheme, token, ...rest] = authorizationHeader.trim().split(/\s+/);

  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
    throw new AuthenticationRequiredException(
      'invalid_request',
      'Authorization header must use Bearer scheme',
    );
  }

  return token;
}

function mapJoseError(error: unknown): AuthenticationRequiredException {
  if (error instanceof AuthenticationRequiredException) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : 'Token validation failed';
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('expired')) {
    return new AuthenticationRequiredException(
      'invalid_token',
      'Token has expired',
    );
  }

  if (
    lowerMessage.includes('signature') ||
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('jws')
  ) {
    return new AuthenticationRequiredException('invalid_token', message);
  }

  return new AuthenticationRequiredException(
    'invalid_token',
    'Token validation failed',
  );
}

@Injectable()
export class JwtValidationService {
  public constructor(
    private readonly jwksCacheService: JwksCacheService,
    private readonly oidcConfigService: OidcConfigService,
  ) {}

  public async validateAuthorizationHeader(
    authorizationHeader: string | undefined,
  ): Promise<AuthContext> {
    const token = extractBearerToken(authorizationHeader);
    const { issuer } = this.oidcConfigService.getConfig();

    try {
      const payload = await verifyAccessToken(
        token,
        async (kid) => this.resolveKeyWithRefresh(kid),
        {
          issuer,
          audience: issuer,
        },
      );

      return normalizeAuthPayload(payload);
    } catch (error) {
      throw mapJoseError(error);
    }
  }

  private async resolveKeyWithRefresh(
    kid: string,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.jwksCacheService.resolveKey(kid);
    } catch {
      await this.jwksCacheService.refresh();
      return this.jwksCacheService.resolveKey(kid);
    }
  }
}
