import type {
  OidcUpstreamCallbackResult,
  OidcUpstreamFederationPort,
  OidcUpstreamInteractionRecord,
  OidcUpstreamLoginResult,
} from '@app/oidc';
import { OidcUpstreamSessionRecord } from '@app/oidc/ports/oidc-upstream-federation.port';
import { Injectable } from '@nestjs/common';

import { OidcUpstreamSession } from './oidc-upstream-session.entity';
import { UpstreamOidcService } from './oidc-upstream.service';

@Injectable()
export class OidcUpstreamFederationAdapter implements OidcUpstreamFederationPort {
  public constructor(
    private readonly upstreamOidcService: UpstreamOidcService,
  ) {}

  private toUpstreamSessionRecord(
    session: OidcUpstreamSession,
  ): OidcUpstreamSessionRecord {
    if (!session.oidcModelId) {
      throw new Error(
        'Expected finalized upstream session to have oidcModelId',
      );
    }

    return {
      id: session.id,
      oidcModelId: session.oidcModelId,
      tenantUserId: session.tenantUserId,
      upstreamSubject: session.upstreamSubject,
      upstreamIdToken: session.upstreamIdToken,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    };
  }

  public async getInteractionByUid(
    interactionUid: string,
  ): Promise<OidcUpstreamInteractionRecord | null> {
    return await this.upstreamOidcService.getInteractionByUid(interactionUid);
  }

  public async logoutUpstreamSessionForOidcSession(input: {
    oidcModelId: string;
    oidcSessionUid?: string | null;
  }): Promise<void> {
    await this.upstreamOidcService.logoutUpstreamSessionForOidcSession(input);
  }

  public async finalizeUpstreamSessionForOidcSession(input: {
    oidcModelId: string;
    oidcSessionUid: string;
    tenantUserId: string;
  }): Promise<OidcUpstreamSessionRecord | null> {
    const session =
      await this.upstreamOidcService.finalizeUpstreamSessionForOidcSession(
        input,
      );

    return session ? this.toUpstreamSessionRecord(session) : null;
  }

  public async stagePendingUpstreamSession(input: {
    tenantUserId: string;
    upstreamSubject: string;
    upstreamIdToken: string;
    expiresAt?: Date | null;
  }): Promise<void> {
    await this.upstreamOidcService.stagePendingUpstreamSession(input);
  }

  public async initiateUpstreamLogin(
    interactionUid: string,
    tenantId: string,
    redirectUri: string,
  ): Promise<OidcUpstreamLoginResult> {
    return await this.upstreamOidcService.initiateUpstreamLogin(
      interactionUid,
      tenantId,
      redirectUri,
    );
  }

  public async handleUpstreamCallback(
    state: string,
    code: string,
    currentUrl: URL,
  ): Promise<OidcUpstreamCallbackResult> {
    return await this.upstreamOidcService.handleUpstreamCallback(
      state,
      code,
      currentUrl,
    );
  }

  public async setTenantUserIdForInteraction(
    state: string,
    tenantUserId: string,
  ): Promise<OidcUpstreamInteractionRecord> {
    return await this.upstreamOidcService.setTenantUserIdForInteraction(
      state,
      tenantUserId,
    );
  }

  public async consumeInteraction(
    state: string,
  ): Promise<OidcUpstreamInteractionRecord> {
    return await this.upstreamOidcService.consumeInteraction(state);
  }
}
