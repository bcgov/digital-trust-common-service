import { CredentialExchangeState } from '@app/credential-ports';
import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { CredentialExchange } from './credential-exchange.entity';
import { CredentialExchangeRepository } from './credential-exchange.repository';

describe('CredentialExchangeRepository', () => {
  const findOne = jest.fn();
  const save = jest.fn();
  const update = jest.fn();
  const create = jest.fn();
  const manager = { create, findOne, save } as unknown as EntityManager;
  const repository = new CredentialExchangeRepository({
    findOne,
    update,
  } as never);
  let row: CredentialExchange;

  beforeEach(() => {
    jest.clearAllMocks();
    row = Object.assign(new CredentialExchange(), {
      id: 'local',
      tenantId: 'tenant',
      connectorId: 'wallet',
      externalId: 'backend',
      state: CredentialExchangeState.RequestReceived,
      issueSubmission: 'not-submitted',
    });
    findOne.mockResolvedValue(row);
    save.mockImplementation((value) => Promise.resolve(value));
  });

  const observe = (state: string) =>
    repository.observe('tenant', 'wallet', 'backend', state, manager, 'local');

  it('creates and saves through the caller transaction', async () => {
    const data = { tenantId: 'tenant', connectorId: 'wallet' };
    create.mockReturnValue(row);
    save.mockResolvedValueOnce(row);

    await expect(repository.create(data, manager)).resolves.toBe(row);

    expect(create).toHaveBeenCalledWith(CredentialExchange, data);
    expect(save).toHaveBeenCalledWith(CredentialExchange, row);
  });

  it('locks issue claims by tenant and ID', async () => {
    await expect(repository.lock('tenant', 'local', manager)).resolves.toBe(
      row,
    );
    expect(findOne).toHaveBeenCalledWith(CredentialExchange, {
      where: { tenantId: 'tenant', id: 'local' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('saves a claimed row through the caller transaction', async () => {
    await expect(repository.save(row, manager)).resolves.toBe(row);
    expect(save).toHaveBeenCalledWith(row);
  });

  it('locks using tenant and connector predicates', async () => {
    await expect(
      observe(CredentialExchangeState.CredentialIssued),
    ).resolves.toEqual({
      exchangeId: row.id,
      from: CredentialExchangeState.RequestReceived,
      to: CredentialExchangeState.CredentialIssued,
    });
    expect(findOne).toHaveBeenCalledWith(CredentialExchange, {
      where: { tenantId: 'tenant', connectorId: 'wallet', id: 'local' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(row.state).toBe(CredentialExchangeState.CredentialIssued);
  });

  it('returns a holder-request transition only once and ignores delayed states', async () => {
    row.state = CredentialExchangeState.OfferSent;
    await expect(observe('request_received')).resolves.toEqual({
      exchangeId: row.id,
      from: CredentialExchangeState.OfferSent,
      to: CredentialExchangeState.RequestReceived,
    });
    await expect(observe('request_received')).resolves.toBeNull();
    await expect(observe('offer_sent')).resolves.toBeNull();
  });

  it.each([
    CredentialExchangeState.CredentialIssued,
    CredentialExchangeState.Done,
    CredentialExchangeState.Abandoned,
    'failed',
  ] as const)(
    'does not overwrite %s on a local offer failure',
    async (state) => {
      row.state = state;
      await repository.markFailed('tenant', 'local', manager);
      expect(row.state).toBe(state);
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('marks a pending offer failed through the same monotonic guard', async () => {
    row.state = 'pending';
    await repository.markFailed('tenant', 'local', manager);
    expect(row.state).toBe('failed');
    expect(save).toHaveBeenCalledWith(row);
    expect(findOne).toHaveBeenCalledWith(CredentialExchange, {
      where: { tenantId: 'tenant', id: 'local' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('does not fail another tenant or missing exchange', async () => {
    findOne.mockResolvedValue(null);
    await repository.markFailed('tenant', 'local', manager);
    expect(save).not.toHaveBeenCalled();
  });

  it('never regresses from done or overwrites issued with abandonment', async () => {
    row.state = CredentialExchangeState.Done;
    await observe(CredentialExchangeState.RequestReceived);
    expect(row.state).toBe(CredentialExchangeState.Done);
    row.state = CredentialExchangeState.CredentialIssued;
    await observe(CredentialExchangeState.Abandoned);
    expect(row.state).toBe(CredentialExchangeState.CredentialIssued);
  });

  it('settles uncertain submission when issuance is positively observed', async () => {
    row.issueSubmission = 'uncertain';
    await observe(CredentialExchangeState.Done);
    expect(row.issueSubmission).toBe('submitted');
  });

  it('normalizes authenticated backend wire states', async () => {
    await observe('credential_issued');
    expect(row.state).toBe(CredentialExchangeState.CredentialIssued);
  });

  it('does not mistake abandonment for proof of successful issuance', async () => {
    row.issueSubmission = 'uncertain';
    await observe(CredentialExchangeState.Abandoned);
    expect(row.state).toBe(CredentialExchangeState.Abandoned);
    expect(row.issueSubmission).toBe('uncertain');
  });

  it('refuses changed backend identity', async () => {
    row.externalId = 'other-backend';
    await expect(observe(CredentialExchangeState.Done)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('does not update foreign or missing rows', async () => {
    findOne.mockResolvedValue(null);
    await observe(CredentialExchangeState.Done);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps unknown protocol states from replacing normalized progress', async () => {
    await observe('unrecognized');
    expect(row.state).toBe(CredentialExchangeState.RequestReceived);
  });

  it('guards submission status by tenant, ID and prior state', async () => {
    await repository.setSubmission('tenant', 'local', 'uncertain');
    expect(update).toHaveBeenCalledWith(
      { tenantId: 'tenant', id: 'local', issueSubmission: 'submitting' },
      { issueSubmission: 'uncertain' },
    );
  });

  it('scopes public lookup to the tenant', async () => {
    await repository.findForTenant('tenant', 'local');
    expect(findOne).toHaveBeenCalledWith({
      where: { tenantId: 'tenant', id: 'local' },
    });
  });
});
