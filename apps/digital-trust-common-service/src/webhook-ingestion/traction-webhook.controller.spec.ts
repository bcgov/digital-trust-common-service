import { ConnectorType } from '../connection/connection.entity';
import { ProtocolStateChangeWorker } from '../protocol-state-change/protocol-state-change.worker';

import type { ConnectorWebhookRequest } from './connector-webhook.guard';
import { TractionWebhookController } from './traction-webhook.controller';

describe('TractionWebhookController', () => {
  let controller: TractionWebhookController;
  let worker: jest.Mocked<Pick<ProtocolStateChangeWorker, 'enqueue'>>;

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
});
