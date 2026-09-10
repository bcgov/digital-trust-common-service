import { ConnectorContext } from '../ports/connector-context';

import { MockAdapter } from './mock-adapter';

describe('integration smoke', () => {
  it('discovers integration specs with the dedicated Jest config', async () => {
    const adapter = new MockAdapter();
    const context: ConnectorContext = {
      connectorId: 'connector-1',
      tenantId: 'tenant-1',
      endpointUrl: 'https://mock.local',
      credentials: {},
    };

    const invitation = await adapter.createInvitation(context, {
      alias: 'integration-smoke',
      label: 'Integration Smoke',
    });

    expect(invitation.connectionId).toBeDefined();
    expect(adapter.getCalls('createInvitation')).toHaveLength(1);
  });
});
