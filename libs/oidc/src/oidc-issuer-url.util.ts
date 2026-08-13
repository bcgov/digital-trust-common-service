const TRAILING_SLASHES = /\/+$/;
const LEADING_SLASHES = /^\/+/;

export function normalizeOidcIssuer(issuer: string): string {
  return issuer.replace(TRAILING_SLASHES, '');
}

export function buildOidcIssuerUrl(
  issuer: string,
  pathSegment: string,
): string {
  return `${normalizeOidcIssuer(issuer)}/${pathSegment.replace(
    LEADING_SLASHES,
    '',
  )}`;
}
