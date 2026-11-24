import type { AuthContext } from '@app/auth';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { assertTenantAccess } from '../common/assert-tenant-access';

import { PresentationExchangeLifecycleService } from './presentation-exchange-lifecycle.service';
import { PresentationExchange } from './presentation-exchange.entity';
import { PresentationExchangeRepository } from './presentation-exchange.repository';

@Injectable()
export class PresentationExchangeService {
  public constructor(
    private readonly exchanges: PresentationExchangeRepository,
    private readonly lifecycle: PresentationExchangeLifecycleService,
  ) {}

  public async get(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<PresentationExchange> {
    assertTenantAccess(auth, tenantId);
    const exchange = await this.exchanges.findForTenant(tenantId, id);
    if (!exchange)
      throw new NotFoundException('Presentation exchange not found');
    return exchange;
  }

  public async reconcile(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<PresentationExchange> {
    const exchange = await this.get(tenantId, id, auth);
    if (!exchange.externalId) {
      throw new ConflictException(
        'Presentation submission has no backend correlation; do not resend.',
      );
    }
    await this.lifecycle.observe(
      tenantId,
      exchange.connectorId,
      exchange.externalId,
    );
    return this.get(tenantId, id, auth);
  }
}
