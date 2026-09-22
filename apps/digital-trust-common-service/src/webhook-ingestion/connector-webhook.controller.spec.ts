import { ProtocolStateChangeWorker } from '../protocol-state-change/protocol-state-change.worker';

import { ConnectorWebhookController } from './connector-webhook.controller';
import type { ConnectorWebhookRequest } from './connector-webhook.guard';

describe('ConnectorWebhookController', () => {
  let controller: ConnectorWebhookController;
  let worker: jest.Mocked<Pick<ProtocolStateChangeWorker, 'enqueue'>>;

  const request = {
    tenantId: 'tenant-1',
    connectorId: 'connector-1',
  } as ConnectorWebhookRequest;

  beforeEach(() => {
    worker = { enqueue: jest.fn().mockResolvedValue('job-1') };
    controller = new ConnectorWebhookController(
      worker as unknown as ProtocolStateChangeWorker,
    );
  });

  it('enqueues a protocol.state-change job for a known topic', async () => {
    const body = {
      credential_exchange_id: 'cred-exch-1',
      state: 'credential_issued',
      thread_id: 'thread-1',
    };

    const result = await controller.receive('issue_credential', body, request);

    expect(worker.enqueue).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      topic: 'issue_credential',
      externalId: 'cred-exch-1',
      protocolState: 'credential_issued',
      payload: body,
    });
    expect(result).toEqual({});
  });

  it('reads the connection_id field for the connections topic', async () => {
    const body = { connection_id: 'conn-1', state: 'active' };

    await controller.receive('connections', body, request);

    expect(worker.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'conn-1' }),
    );
  });

  it('acknowledges an unknown topic without enqueuing', async () => {
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
      'issue_credential',
      { state: 'credential_issued' },
      request,
    );

    expect(result).toEqual({});
    expect(worker.enqueue).not.toHaveBeenCalled();
  });

  it('acknowledges a payload missing state without enqueuing', async () => {
    const result = await controller.receive(
      'issue_credential',
      { credential_exchange_id: 'cred-exch-1' },
      request,
    );

    expect(result).toEqual({});
    expect(worker.enqueue).not.toHaveBeenCalled();
  });
});
