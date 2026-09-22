import { timingSafeEqual } from 'crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { EncryptionService } from '../common/crypto/encryption.service';
import type { ConnectorType } from '../connection/connection.entity';
import { ConnectorCredentialService } from '../connector-credential/connector-credential.service';
import type { ConnectorCredentialsDto } from '../connector-credential/dto/create-connector-credential.dto';

// ACA-Py sends the wallet_webhook_urls '#secret' fragment back on every
// webhook call as this header.
export const WEBHOOK_SECRET_HEADER = 'x-api-key';

export type ConnectorWebhookRequest = Request & {
  /** Set once the guard verifies the connector's shared secret. */
  connectorId?: string;
  /** The connector's owning tenant, resolved from the connector row itself. */
  tenantId?: string;
  /** The connector's type, resolved from the connector row itself. */
  connectorType?: ConnectorType;
};

/**
 * Verifies an inbound webhook call against the shared secret configured on
 * the `:connectorId` route param's ConnectorCredential, regardless of the
 * connector type (Traction, Credo, ...). There is no tenant JWT here — the
 * connector id and its secret are the credential, and every rejection reason
 * (unknown id, inactive, no secret configured, wrong secret) returns the
 * same generic 401 so a caller can't distinguish one from another.
 */
@Injectable()
export class ConnectorWebhookGuard implements CanActivate {
  public constructor(
    private readonly connectorCredentialService: ConnectorCredentialService,
    private readonly encryptionService: EncryptionService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<ConnectorWebhookRequest>();
    const connectorId = request.params.connectorId;
    const providedSecret = request.headers[WEBHOOK_SECRET_HEADER];

    if (
      typeof connectorId !== 'string' ||
      !connectorId ||
      typeof providedSecret !== 'string' ||
      !providedSecret
    ) {
      throw new UnauthorizedException('Webhook authentication failed');
    }

    const credential =
      await this.connectorCredentialService.findActiveForWebhook(connectorId);

    if (!credential) {
      throw new UnauthorizedException('Webhook authentication failed');
    }

    const decrypted = this.encryptionService.decrypt<ConnectorCredentialsDto>(
      credential.credentialsEncrypted,
      credential.keyVersion,
    );

    if (!this.secretMatches(decrypted.webhookSecret, providedSecret)) {
      throw new UnauthorizedException('Webhook authentication failed');
    }

    request.connectorId = connectorId;
    request.tenantId = credential.tenantId;
    request.connectorType = credential.connectorType;
    return true;
  }

  private secretMatches(
    configured: string | undefined,
    provided: string,
  ): boolean {
    if (!configured) {
      return false;
    }

    const expected = Buffer.from(configured, 'utf8');
    const actual = Buffer.from(provided, 'utf8');

    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}
