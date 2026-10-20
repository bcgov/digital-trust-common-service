import {
  CredentialExchange as RemoteExchange,
  CredentialExchangeState,
} from '@app/credential-ports';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { ConnectionRepository } from '../connection/connection.repository';
import { toPortCredentialFormat } from '../credential-definition/credential-definition.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import { ProtocolStateChangeService } from '../protocol-state-change/protocol-state-change.service';

import { CredentialExchange } from './credential-exchange.entity';
import { CredentialExchangeRepository } from './credential-exchange.repository';

@Injectable()
export class CredentialExchangeService {
  private readonly logger = new Logger(CredentialExchangeService.name);

  public constructor(
    private readonly exchanges: CredentialExchangeRepository,
    private readonly connections: ConnectionRepository,
    private readonly adapters: AdapterRegistry,
    private readonly operations: OperationRepository,
    private readonly operationService: OperationService,
    private readonly protocolStateChanges: ProtocolStateChangeService,
    private readonly audit: DomainAuditService,
    private readonly dataSource: DataSource,
  ) {}

  public async get(tenantId: string, id: string): Promise<CredentialExchange> {
    const exchange = await this.exchanges.findForTenant(tenantId, id);
    if (!exchange) throw new NotFoundException('Credential exchange not found');
    return exchange;
  }

  private async resolve(exchange: CredentialExchange) {
    if (!exchange.externalId) {
      throw new ConflictException(
        'Exchange has no verified backend correlation; do not resend',
      );
    }
    const format = toPortCredentialFormat(exchange.format);
    if (!format)
      throw new ConflictException('Exchange format is not supported');
    return this.adapters.resolve(exchange.tenantId, format, {
      connectorId: exchange.connectorId,
    });
  }

  private async assertCorrelation(
    exchange: CredentialExchange,
    remote: RemoteExchange,
  ): Promise<void> {
    if ((remote.externalId ?? remote.id) !== exchange.externalId) {
      throw new ConflictException('Backend returned a different exchange');
    }
    if (exchange.protocol !== 'didcomm-v1' || !exchange.connectionId) {
      throw new ConflictException(
        'Exchange delivery protocol is not supported',
      );
    }
    const connection = await this.connections.findByIdForTenant(
      exchange.tenantId,
      exchange.connectionId,
    );
    if (
      !connection ||
      connection.connectorId !== exchange.connectorId ||
      !connection.externalConnectionId ||
      remote.connectionId !== connection.externalConnectionId
    ) {
      throw new ConflictException(
        'Exchange holder or connector correlation is inconsistent',
      );
    }
  }

  private async synchronize(
    exchange: CredentialExchange,
    remote: RemoteExchange,
  ): Promise<void> {
    await this.protocolStateChanges.process(
      {
        tenantId: exchange.tenantId,
        topic: 'issue_credential',
        externalId: exchange.externalId!,
        protocolState: remote.state,
        payload: { state: remote.state, exchange_id: exchange.externalId },
      },
      { exchangeId: exchange.id, connectorId: exchange.connectorId },
    );
  }

  public async reconcile(
    tenantId: string,
    id: string,
  ): Promise<CredentialExchange> {
    const exchange = await this.get(tenantId, id);
    const { adapter, context } = await this.resolve(exchange);
    const remote = await adapter.getExchange(context, exchange.externalId!);
    await this.assertCorrelation(exchange, remote);
    await this.synchronize(exchange, remote);
    return this.get(tenantId, id);
  }

  public async issue(tenantId: string, id: string): Promise<Operation> {
    const exchange = await this.get(tenantId, id);
    if (exchange.role !== 'issuer')
      throw new ConflictException('Only issuer exchanges can issue');
    const { adapter, context } = await this.resolve(exchange);
    const remote = await adapter.getExchange(context, exchange.externalId!);
    await this.assertCorrelation(exchange, remote);
    await this.synchronize(exchange, remote);

    const claim = await this.dataSource.transaction(async (manager) => {
      const locked = await this.exchanges.lock(tenantId, id, manager);
      if (!locked) throw new NotFoundException('Credential exchange not found');
      if (locked.issueSubmission !== 'not-submitted') {
        const existing = locked.issueOperationId
          ? await this.operations.findByIdForTenant(
              locked.issueOperationId,
              tenantId,
              manager,
            )
          : null;
        if (!existing)
          throw new ConflictException(
            'Issuance already attempted; reconcile the exchange, do not resubmit',
          );
        return { operation: existing, submit: false };
      }
      if (
        locked.state !== CredentialExchangeState.RequestReceived ||
        remote.state !== CredentialExchangeState.RequestReceived
      ) {
        throw new ConflictException(
          'Exchange must have a holder request before explicit issuance',
        );
      }
      const operation = await this.operationService.createOperation(
        {
          tenantId,
          exchangeId: id,
          type: OPERATION_TYPE.CREDENTIAL_ISSUE,
          externalId: exchange.externalId,
          request: {
            method: 'POST',
            path: `${API_BASE_PATH}/tenants/${tenantId}/credential-exchanges/${id}/issue`,
            body: {},
          },
        },
        manager,
      );
      locked.issueSubmission = 'submitting';
      locked.issueOperationId = operation.id;
      await this.exchanges.save(locked, manager);
      await this.operationService.transitionStateIfForward(
        operation.id,
        OperationState.PROCESSING,
        [OperationState.PENDING],
        undefined,
        manager,
      );
      await this.audit.emit(
        {
          tenantId,
          action: AuditAction.ISSUE,
          resourceType: 'credential-exchange',
          resourceId: id,
          metadata: { operation_id: operation.id },
        },
        manager,
      );
      return { operation, submit: true };
    });

    if (!claim.submit)
      return this.operationService.getForTenant(tenantId, claim.operation.id);
    try {
      const issued = await adapter.issueCredential(
        context,
        exchange.externalId!,
      );
      await this.assertCorrelation(exchange, issued);
      await this.exchanges.setSubmission(tenantId, id, 'submitted');
      await this.synchronize(exchange, issued);
    } catch (error) {
      await this.exchanges.setSubmission(tenantId, id, 'uncertain');
      this.logger.warn(
        { exchange_id: id, operation_id: claim.operation.id },
        'Issuance outcome requires reconciliation; submission will not be retried',
      );
      throw new ServiceUnavailableException(
        {
          message:
            'Issuance outcome uncertain; reconcile this exchange, do not resubmit',
          exchange_id: id,
          operation_id: claim.operation.id,
        },
        { cause: error },
      );
    }
    return this.operationService.getForTenant(tenantId, claim.operation.id);
  }
}
