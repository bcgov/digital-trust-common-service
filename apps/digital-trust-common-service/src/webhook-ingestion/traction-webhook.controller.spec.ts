import { Logger } from '@nestjs/common';

import { ConnectorType } from '../connection/connection.entity';
import { ProtocolStateChangeWorker } from '../protocol-state-change/protocol-state-change.worker';

import type { ConnectorWebhookRequest } from './connector-webhook.guard';
import { TractionWebhookController } from './traction-webhook.controller';

describe('TractionWebhookController', () => {
  let controller: TractionWebhookController;
  let worker: jest.Mocked<Pick<ProtocolStateChangeWorker, 'enqueue'>>;
  let logDebug: jest.SpiedFunction<typeof Logger.prototype.debug>;
  let logLine: jest.SpiedFunction<typeof Logger.prototype.log>;
  let logWarn: jest.SpiedFunction<typeof Logger.prototype.warn>;

  const request = {
    tenantId: 'tenant-1',
    connectorId: 'connector-1',
    connectorType: ConnectorType.TRACTION,
  } as ConnectorWebhookRequest;

  beforeEach(() => {
    worker = { enqueue: jest.fn().mockResolvedValue('job-1') };
    controller = new TractionWebhookController(
      worker as unknown as ProtocolStateChangeWorker,
    );
    // The controller's logger is an instance field, so the prototype is the
    // seam.
    logDebug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    logLine = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps the Traction wire topic to the generic ProtocolTopic and enqueues a job', async () => {
    const body = {
      cred_ex_id: 'cred-exch-1',
      state: 'credential_issued',
      thread_id: 'thread-1',
    };

    const result = await controller.receive(
      'issue_credential_v2_0',
      body,
      request,
    );

    expect(worker.enqueue).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      topic: 'issue_credential',
      externalId: 'cred-exch-1',
      protocolState: 'credential_issued',
      payload: body,
    });
    expect(result).toEqual({});
  });

  it('reads the connection_id field for the connections wire topic', async () => {
    const body = { connection_id: 'conn-1', state: 'active' };

    await controller.receive('connections', body, request);

    expect(worker.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'connections',
        externalId: 'conn-1',
      }),
    );
  });

  it('reads the cred_ex_id field for the issuer_cred_rev wire topic', async () => {
    const body = { cred_ex_id: 'cred-exch-1', state: 'revoked' };

    await controller.receive('issuer_cred_rev', body, request);

    expect(worker.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'revocation_registry',
        externalId: 'cred-exch-1',
      }),
    );
  });

  it('acknowledges any topic for a connector type with no wire topic mappings', async () => {
    const credoRequest = {
      ...request,
      connectorType: ConnectorType.CREDO,
    } as ConnectorWebhookRequest;

    const result = await controller.receive(
      'issue_credential_v2_0',
      { cred_ex_id: 'cred-exch-1', state: 'credential_issued' },
      credoRequest,
    );

    expect(result).toEqual({});
    expect(worker.enqueue).not.toHaveBeenCalled();
  });

  it('acknowledges an unknown wire topic without enqueuing', async () => {
    const result = await controller.receive(
      'unknown_topic',
      { state: 'x' },
      request,
    );

    expect(result).toEqual({});
    expect(worker.enqueue).not.toHaveBeenCalled();
  });

  it('acknowledges a payload missing the topic-specific external id field without enqueuing', async () => {
    const result = await controller.receive(
      'issue_credential_v2_0',
      { state: 'credential_issued' },
      request,
    );

    expect(result).toEqual({});
    expect(worker.enqueue).not.toHaveBeenCalled();
  });

  it('acknowledges a payload missing state without enqueuing', async () => {
    const result = await controller.receive(
      'issue_credential_v2_0',
      { cred_ex_id: 'cred-exch-1' },
      request,
    );

    expect(result).toEqual({});
    expect(worker.enqueue).not.toHaveBeenCalled();
  });

  /**
   * The webhook ingestion events: what arrived, and whether it was enqueued
   * or dropped. The assertions name the whole payload rather than the
   * interesting key, so a field added later has to be added here
   * deliberately — that is the control that keeps the webhook body out of the
   * logs, not the redaction backstop in the logger config.
   *
   * `tenant_id`, `request_id`, and `operation_id` are deliberately absent: the
   * pino mixin attaches them from the request context, which
   * `ConnectorWebhookGuard` has already resolved the tenant into.
   */
  describe('webhook ingestion events', () => {
    it('logs an accepted delivery naming the topic, state, and external id', async () => {
      await controller.receive(
        'issue_credential_v2_0',
        {
          cred_ex_id: 'cred-exch-1',
          state: 'credential_issued',
          attributes: [{ name: 'given_name', value: 'Alice' }],
        },
        request,
      );

      expect(logLine).toHaveBeenCalledWith(
        {
          connector_id: 'connector-1',
          connector_type: ConnectorType.TRACTION,
          external_id: 'cred-exch-1',
          outcome: 'accepted',
          protocol_state: 'credential_issued',
          topic: 'issue_credential',
          wire_topic: 'issue_credential_v2_0',
        },
        'webhook accepted',
      );
      expect(logWarn).not.toHaveBeenCalled();
    });

    it('logs an unconsumed topic at debug rather than as a fault', async () => {
      await controller.receive('ping', { state: 'x' }, request);

      expect(logDebug).toHaveBeenCalledWith(
        {
          connector_id: 'connector-1',
          connector_type: ConnectorType.TRACTION,
          drop_reason: 'unknown_topic',
          outcome: 'dropped',
          wire_topic: 'ping',
        },
        'webhook dropped',
      );
      expect(logWarn).not.toHaveBeenCalled();
      expect(logLine).not.toHaveBeenCalled();
    });

    it('warns when a consumed topic arrives without its external id', async () => {
      await controller.receive(
        'issue_credential_v2_0',
        { state: 'credential_issued' },
        request,
      );

      expect(logWarn).toHaveBeenCalledWith(
        {
          connector_id: 'connector-1',
          connector_type: ConnectorType.TRACTION,
          drop_reason: 'missing_external_id',
          outcome: 'dropped',
          topic: 'issue_credential',
          wire_topic: 'issue_credential_v2_0',
        },
        'webhook dropped',
      );
      expect(logLine).not.toHaveBeenCalled();
    });

    it('warns when a consumed topic arrives without a state', async () => {
      await controller.receive(
        'connections',
        { connection_id: 'conn-1' },
        request,
      );

      expect(logWarn).toHaveBeenCalledWith(
        {
          connector_id: 'connector-1',
          connector_type: ConnectorType.TRACTION,
          drop_reason: 'missing_state',
          external_id: 'conn-1',
          outcome: 'dropped',
          topic: 'connections',
          wire_topic: 'connections',
        },
        'webhook dropped',
      );
      expect(logLine).not.toHaveBeenCalled();
    });
  });
});
