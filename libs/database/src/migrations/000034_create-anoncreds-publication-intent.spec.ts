import { CreateAnoncredsPublicationIntent1793375200834 } from './000034_create-anoncreds-publication-intent';

describe('AnonCreds publication intent migration', () => {
  it('keys durable intent by tenant, pinned connector and artifact', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new CreateAnoncredsPublicationIntent1793375200834().up({
      query,
    } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'PRIMARY KEY (tenant_id, connector_id, artifact_key)',
      ),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "CHECK (state IN ('publishing', 'submitted', 'rejected'))",
      ),
    );
  });

  it('preserves existing pending evidence and conclusive rejection on upgrade', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          tenant_id: 'tenant',
          connector_id: 'connector',
          schema_definition: { schema_name: 'Employee', schema_version: '1.0' },
          options: { tag: 'default' },
          registration: {
            issuerId: 'issuer',
            schema: { id: 'schema', state: 'finished' },
            definition: { state: 'failed' },
          },
        },
      ]);
    await new CreateAnoncredsPublicationIntent1793375200834().up({
      query,
    } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO anoncreds_publication_intent'),
      [
        'tenant',
        'connector',
        expect.stringMatching(/^[a-f0-9]{64}$/),
        'submitted',
      ],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO anoncreds_publication_intent'),
      [
        'tenant',
        'connector',
        expect.stringMatching(/^[a-f0-9]{64}$/),
        'rejected',
      ],
    );
  });

  it('drops only the added intent table on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateAnoncredsPublicationIntent1793375200834().down({
      query,
    } as never);
    expect(query).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS anoncreds_publication_intent',
    );
  });

  it('closes an uncertain publication even without saved correlation', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          tenant_id: 'tenant',
          connector_id: 'connector',
          schema_definition: { schema_name: 'Employee', schema_version: '1.0' },
          options: { tag: 'default' },
          registration: {
            issuerId: 'issuer',
            stage: 'schema_publication',
            schema: {},
            definition: {},
          },
        },
      ]);
    await new CreateAnoncredsPublicationIntent1793375200834().up({
      query,
    } as never);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO anoncreds_publication_intent'),
      [
        'tenant',
        'connector',
        expect.stringMatching(/^[a-f0-9]{64}$/),
        'submitted',
      ],
    );
  });
});
