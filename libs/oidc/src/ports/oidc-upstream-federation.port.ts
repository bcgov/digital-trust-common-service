export interface OidcUpstreamInteractionRecord {
  state: string;
  interactionUid: string;
  tenantId: string;
  tenantUserId?: string | null;
  consumedAt?: Date | null;
}

export interface OidcUpstreamClaims {
  sub: string;
  email?: string;
  name?: string;
}

export interface OidcUpstreamCallbackResult {
  claims: OidcUpstreamClaims;
  interaction: OidcUpstreamInteractionRecord;
}

export interface OidcUpstreamLoginResult {
  state: string;
  authorizationUrl: URL;
}

export interface OidcUpstreamFederationPort {
  getInteractionByUid(
    interactionUid: string,
  ): Promise<OidcUpstreamInteractionRecord | null>;
  initiateUpstreamLogin(
    interactionUid: string,
    tenantId: string,
    redirectUri: string,
  ): Promise<OidcUpstreamLoginResult>;
  handleUpstreamCallback(
    state: string,
    code: string,
    currentUrl: URL,
  ): Promise<OidcUpstreamCallbackResult>;
  setTenantUserIdForInteraction(
    state: string,
    tenantUserId: string,
  ): Promise<OidcUpstreamInteractionRecord>;
  consumeInteraction(state: string): Promise<OidcUpstreamInteractionRecord>;
}

export const OIDC_UPSTREAM_FEDERATION_PORT = Symbol(
  'OIDC_UPSTREAM_FEDERATION_PORT',
);
