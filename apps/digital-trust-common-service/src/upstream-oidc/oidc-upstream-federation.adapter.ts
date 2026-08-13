import type {
  OidcUpstreamCallbackResult,
  OidcUpstreamFederationPort,
  OidcUpstreamInteractionRecord,
  OidcUpstreamLoginResult,
} from '@app/oidc';
import { Injectable } from '@nestjs/common';

import { UpstreamOidcService } from './oidc-upstream.service';

@Injectable()
export class OidcUpstreamFederationAdapter implements OidcUpstreamFederationPort {
  public constructor(
    private readonly upstreamOidcService: UpstreamOidcService,
  ) {}

  public async getInteractionByUid(
    interactionUid: string,
  ): Promise<OidcUpstreamInteractionRecord | null> {
    return await this.upstreamOidcService.getInteractionByUid(interactionUid);
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
