import { CredentialExchangeState } from '@app/credential-ports';
import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { CredentialExchange } from './credential-exchange.entity';
import { CredentialExchangeRepository } from './credential-exchange.repository';

describe('CredentialExchangeRepository', () => {
  const findOne = jest.fn();
  const save = jest.fn();
  const update = jest.fn();
  const manager = { findOne, save } as unknown as EntityManager;
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

  it('locks using tenant and connector predicates', async () => {
    await observe(CredentialExchangeState.CredentialIssued);
    expect(findOne).toHaveBeenCalledWith(CredentialExchange, {
      where: { tenantId: 'tenant', connectorId: 'wallet', id: 'local' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(row.state).toBe(CredentialExchangeState.CredentialIssued);
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
