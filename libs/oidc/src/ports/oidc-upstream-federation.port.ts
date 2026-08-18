export interface OidcUpstreamInteractionRecord {
  state: string;
  interactionUid: string;
  tenantId: string;
  tenantUserId?: string | null;
  consumedAt?: Date | null;
}

export interface OidcPendingUpstreamSessionRecord {
  id?: string;
  oidcSessionUid?: string;
  tenantUserId?: string;
  upstreamSubject: string;
  upstreamIdToken: string;
  expiresAt?: Date | null;
}

export interface OidcUpstreamSessionRecord {
  id: string;
  oidcModelId: string;
  tenantUserId: string;
  upstreamSubject: string;
  upstreamIdToken: string;
  createdAt: Date;
  expiresAt?: Date | null;
}

export interface OidcUpstreamClaims {
  sub: string;
  email?: string;
  name?: string;
}

export interface OidcUpstreamCallbackResult {
  claims: OidcUpstreamClaims;
  interaction: OidcUpstreamInteractionRecord;
  upstreamSession: OidcPendingUpstreamSessionRecord;
}

export interface OidcUpstreamLoginResult {
  state: string;
  authorizationUrl: URL;
}

export interface OidcUpstreamFederationPort {
  logoutUpstreamSessionForOidcSession(input: {
    oidcModelId: string;
    oidcSessionUid?: string | null;
  }): Promise<void>;

  /**
   * Deletes a batch of expired pending upstream sessions (oidcModelId IS NULL).
   * These accumulate when finalization fails after callback staging and cannot
   * be cascade-deleted by oidc_model cleanup.
   *
   * @returns The number of expired pending sessions deleted.
   */
  deleteExpiredPendingSessionBatch(limit: number): Promise<number>;

  getInteractionByUid(
    interactionUid: string,
  ): Promise<OidcUpstreamInteractionRecord | null>;
  finalizeUpstreamSessionForOidcSession(input: {
    oidcModelId: string;
    oidcSessionUid: string;
    tenantUserId: string;
  }): Promise<OidcUpstreamSessionRecord | null>;
  stagePendingUpstreamSession(input: {
    tenantUserId: string;
    upstreamSubject: string;
    upstreamIdToken: string;
    expiresAt?: Date | null;
  }): Promise<void>;
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
