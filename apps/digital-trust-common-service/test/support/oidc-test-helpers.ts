import { extractBearerToken, verifyAccessToken } from '@app/auth';
import { importJWK, jwtVerify } from 'jose';
import request from 'supertest';
import { App } from 'supertest/types';

/**
 * Shared token-issue-and-verify logic between
 * `oidc-client-credentials.integration-spec.ts` (seeds via raw SQL against
 * a standalone DataSource) and `oidc-client-credentials.e2e-spec.ts` (seeds
 * via the app's own TypeORM repositories). The seeding strategies are
 * intentionally different (see each file's docblock) and are NOT factored
 * out here; only the identical "POST /oidc/token, then verify the returned
 * JWT against /oidc/jwks" steps are.
 */

export function buildBasicAuthHeader(
  clientId: string,
  clientSecret: string,
): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export interface IssuedTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

type JwksDocument = {
  keys: Array<Record<string, unknown>>;
};

function resolveJwkFromDocument(
  keys: Array<Record<string, unknown>>,
  kid: string | undefined,
): Record<string, unknown> {
  const jwk = keys.find((key) => key.kid === kid);

  if (!jwk) {
    throw new Error('Signing key not found in JWKS response');
  }

  return jwk;
}

async function verifyTokenWithJwksDocument(
  token: string,
  jwksBody: JwksDocument,
  issuer?: string,
): Promise<Record<string, unknown>> {
  if (issuer) {
    return verifyAccessToken(
      token,
      (kid) => Promise.resolve(resolveJwkFromDocument(jwksBody.keys, kid)),
      { issuer, audience: issuer },
    );
  }

  const { payload } = await jwtVerify(token, async (protectedHeader) => {
    const jwk = resolveJwkFromDocument(jwksBody.keys, protectedHeader.kid);

    return importJWK(jwk, protectedHeader.alg);
  });

  return payload;
}

/**
 * Verifies an already-issued access token against the live `/oidc/jwks`
 * endpoint, selecting the verification key by the JWT's `kid`. Split out from
 * `issueTokenAndVerify` so a token minted against one running instance can be
 * verified against another (see `oidc-key-rotation.e2e-spec.ts`, which mints
 * before a key rotation and verifies after it).
 */
export async function verifyTokenAgainstJwks(
  httpServer: App,
  accessToken: string,
  issuer?: string,
): Promise<Record<string, unknown>> {
  const jwksResponse = await request(httpServer).get('/oidc/jwks').expect(200);
  const jwksBody = jwksResponse.body as JwksDocument;
  const token = extractBearerToken(`Bearer ${accessToken}`);

  return verifyTokenWithJwksDocument(token, jwksBody, issuer);
}

/**
 * Requests a client_credentials access token, then verifies it against the
 * live `/oidc/jwks` endpoint. Returns both the raw token response fields
 * and the verified JWT payload/claims.
 */
export async function issueTokenAndVerify(
  httpServer: App,
  clientId: string,
  clientSecret: string,
  scope: string,
  issuer?: string,
): Promise<{
  token: IssuedTokenResponse;
  payload: Record<string, unknown>;
}> {
  const tokenResponse = await request(httpServer)
    .post('/oidc/token')
    .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
    .type('form')
    .send({ grant_type: 'client_credentials', scope })
    .expect(200);

  const tokenBody = tokenResponse.body as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };

  const payload = await verifyTokenAgainstJwks(
    httpServer,
    tokenBody.access_token,
    issuer,
  );

  return {
    token: {
      accessToken: tokenBody.access_token,
      tokenType: tokenBody.token_type,
      expiresIn: tokenBody.expires_in,
    },
    payload,
  };
}
