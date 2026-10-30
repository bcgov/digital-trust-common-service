import { AddConnectorAgentLogIdHash1793385084139 } from './000035_add-connector-agent-log-id-hash';

describe('connector agent log id hash migration', () => {
  it('adds a nullable hash with a partial unique index over active rows', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await new AddConnectorAgentLogIdHash1793385084139().up({ query } as never);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN agent_log_id_hash text;'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /CREATE UNIQUE INDEX uq_connector_credential_agent_log_id_hash[\s\S]*WHERE active = true AND agent_log_id_hash IS NOT NULL/,
      ),
    );
  });
});
