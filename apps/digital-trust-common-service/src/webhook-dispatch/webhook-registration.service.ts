import { randomBytes } from 'node:crypto';

import {
  InsufficientScopeException,
  ScopeAuthorizationService,
  WEBHOOKS_MANAGE_SCOPE,
  type AuthContext,
} from '@app/auth';
import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { assertSafePublicHttpsUrl } from '../common/assert-safe-connector-url';
import { assertTenantAccess } from '../common/assert-tenant-access';
import { EncryptionService } from '../common/crypto/encryption.service';

import { CreateWebhookRegistrationDto } from './dto/create-webhook-registration.dto';
import { WebhookRegistration } from './webhook-registration.entity';
import { WebhookRegistrationRepository } from './webhook-registration.repository';

@Injectable()
export class WebhookRegistrationService {
  public constructor(
    private readonly registrations: WebhookRegistrationRepository,
    private readonly encryption: EncryptionService,
    private readonly domainAudit: DomainAuditService,
    private readonly scopeAuthorization: ScopeAuthorizationService,
  ) {}

  public async create(
    tenantId: string,
    dto: CreateWebhookRegistrationDto,
    auth: AuthContext | undefined,
  ): Promise<{ registration: WebhookRegistration; signingSecret: string }> {
    this.assertAccess(tenantId, auth);
    await assertSafePublicHttpsUrl(dto.endpointUrl, 'Webhook endpoint');
    const signingSecret = randomBytes(32).toString('base64url');
    const { ciphertext, keyVersion } = this.encryption.encrypt({
      signingSecret,
    });
    const registration = await this.registrations.create(tenantId, {
      endpointUrl: dto.endpointUrl,
      events: dto.events,
      credentialsEncrypted: ciphertext,
      keyVersion,
    });
    await this.domainAudit.emit({
      tenantId,
      action: AuditAction.CREATE,
      resourceType: 'webhook_registration',
      resourceId: registration.id,
    });

    return { registration, signingSecret };
  }

  public async findByTenant(
    tenantId: string,
    auth: AuthContext | undefined,
  ): Promise<WebhookRegistration[]> {
    this.assertAccess(tenantId, auth);
    return this.registrations.findByTenant(tenantId);
  }

  public async delete(
    tenantId: string,
    id: string,
    auth: AuthContext | undefined,
  ): Promise<void> {
    this.assertAccess(tenantId, auth);
    if (!(await this.registrations.deleteByTenantAndId(tenantId, id))) {
      throw new NotFoundException('Webhook registration not found.');
    }
    await this.domainAudit.emit({
      tenantId,
      action: AuditAction.DELETE,
      resourceType: 'webhook_registration',
      resourceId: id,
    });
  }

  private assertAccess(tenantId: string, auth: AuthContext | undefined): void {
    assertTenantAccess(auth, tenantId);
    if (
      !auth ||
      (!this.scopeAuthorization.isPlatformAdmin(auth.roles) &&
        !this.scopeAuthorization.hasRequiredScopes(auth.scopes, [
          WEBHOOKS_MANAGE_SCOPE,
        ]))
    ) {
      throw new InsufficientScopeException('Token lacks webhooks:manage.', {
        requiredScopes: [WEBHOOKS_MANAGE_SCOPE],
      });
    }
  }
}
