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

  const jwksResponse = await request(httpServer).get('/oidc/jwks').expect(200);

  const jwksBody = jwksResponse.body as {
    keys: Array<Record<string, unknown>>;
  };

  const { payload } = await jwtVerify(
    tokenBody.access_token,
    async (protectedHeader) => {
      const jwk = jwksBody.keys.find((key) => key.kid === protectedHeader.kid);

      if (!jwk) {
        throw new Error('Signing key not found in JWKS response');
      }

      return importJWK(jwk, protectedHeader.alg);
    },
    issuer ? { issuer } : undefined,
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
