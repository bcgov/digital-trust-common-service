import type { AuthContext } from '@app/auth';
import { BackendNotFoundError } from '@app/credential-ports';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { assertTenantAccess } from '../common/assert-tenant-access';
import { ConnectionRepository } from '../connection/connection.repository';
import { ProtocolStateChangeService } from '../protocol-state-change/protocol-state-change.service';
import { resolveProtocolOutcome } from '../protocol-state-change/state-mapping';

import { PresentationExchange } from './presentation-exchange.entity';
import { PresentationExchangeRepository } from './presentation-exchange.repository';

@Injectable()
export class PresentationExchangeService {
  public constructor(
    private readonly exchanges: PresentationExchangeRepository,
    private readonly connections: ConnectionRepository,
    private readonly adapters: AdapterRegistry,
    private readonly protocol: ProtocolStateChangeService,
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
    if (!exchange.externalId || !exchange.connectionId) {
      throw new ConflictException(
        'Presentation submission has no verified backend correlation; do not resend.',
      );
    }
    const connection = await this.connections.findByIdForTenant(
      tenantId,
      exchange.connectionId,
    );
    if (
      !connection ||
      connection.externalConnectionId !== exchange.externalConnectionId ||
      (connection.connectorId &&
        connection.connectorId !== exchange.connectorId)
    ) {
      throw new ConflictException(
        'Presentation connection correlation changed.',
      );
    }
    const resolved = await this.adapters.resolve(tenantId, exchange.format, {
      connectorId: exchange.connectorId,
    });
    let remote;
    try {
      remote = await resolved.adapter.getPresentation(
        resolved.context,
        exchange.externalId,
      );
    } catch (error) {
      if (error instanceof BackendNotFoundError) {
        throw new ConflictException(
          'Backend presentation exchange was not found.',
        );
      }
      throw error;
    }
    if (
      (remote.externalId ?? remote.id) !== exchange.externalId ||
      remote.connectionId !== exchange.externalConnectionId
    ) {
      throw new ConflictException('Backend presentation correlation changed.');
    }
    if (
      !resolveProtocolOutcome('present_proof', remote.state, remote.verified)
    ) {
      throw new ConflictException('Backend presentation state is unsupported.');
    }
    await this.protocol.process({
      tenantId,
      connectorId: exchange.connectorId,
      topic: 'present_proof',
      externalId: exchange.externalId,
      protocolState: remote.state,
      payload: { verified: remote.verified },
    });
    return this.get(tenantId, id, auth);
  }
}
