import { ConnectorType } from '../enums/connector-type.enum';
import { CredentialFormat } from '../enums/credential-format.enum';
import {
  ConnectionState,
  CredentialExchangeState,
  PresentationExchangeState,
} from '../enums/exchange-state.enum';
import {
  ConnectorUnavailableError,
  TimeoutError,
  ValidationError,
} from '../errors/adapter-error';

import { MockAdapter } from './mock-adapter';

describe('MockAdapter', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should default to traction with anoncreds capability metadata', () => {
    expect(adapter.connectorType).toBe(ConnectorType.Traction);
    expect(adapter.supportedFormats).toEqual([CredentialFormat.AnonCreds]);
  });

  it('should take capability metadata from config so tests can register distinct adapters', () => {
    const credo = new MockAdapter({
      connectorType: ConnectorType.Credo,
      supportedFormats: [CredentialFormat.SdJwtVc, CredentialFormat.JsonLd],
    });

    expect(credo.connectorType).toBe(ConnectorType.Credo);
    expect(credo.supportedFormats).toEqual([
      CredentialFormat.SdJwtVc,
      CredentialFormat.JsonLd,
    ]);
  });

  it('should resolve issuer, holder, and revocation operations with in-memory state by default', async () => {
    const exchange = await adapter.offerCredential({
      connectionId: 'connection-1',
      format: CredentialFormat.AnonCreds,
      attributes: [{ name: 'given_name', value: 'Avery' }],
      autoIssue: true,
    });

    expect(exchange.id).toBeDefined();
    expect(exchange.connectionId).toBe('connection-1');
    expect(exchange.state).toBe(CredentialExchangeState.CredentialIssued);

    await expect(adapter.getExchange(exchange.id)).resolves.toEqual(exchange);

    const acceptedExchange = await adapter.acceptOffer(exchange.id);

    expect(acceptedExchange.id).toBe(exchange.id);
    expect(acceptedExchange.state).toBe(CredentialExchangeState.Done);

    await expect(adapter.getExchange(exchange.id)).resolves.toEqual(
      acceptedExchange,
    );

    const rejectedExchange = await adapter.offerCredential({
      format: CredentialFormat.JsonLd,
      attributes: [{ name: 'family_name', value: 'Nguyen' }],
    });

    await expect(
      adapter.rejectOffer(rejectedExchange.id),
    ).resolves.toBeUndefined();
    await expect(
      adapter.getExchange(rejectedExchange.id),
    ).resolves.toMatchObject({
      id: rejectedExchange.id,
      state: CredentialExchangeState.Abandoned,
      error: 'Offer rejected',
    });

    await expect(adapter.revoke(exchange.id)).resolves.toMatchObject({
      credentialId: exchange.id,
      revoked: true,
    });
    await expect(
      adapter.batchRevoke([exchange.id, rejectedExchange.id]),
    ).resolves.toEqual([
      expect.objectContaining({
        credentialId: exchange.id,
        revoked: true,
      }),
      expect.objectContaining({
        credentialId: rejectedExchange.id,
        revoked: true,
      }),
    ]);
  });

  it('should resolve verifier operations with in-memory state by default', async () => {
    const exchange = await adapter.requestPresentation({
      connectionId: 'connection-2',
      name: 'Proof request',
      requestedAttributes: [{ name: 'given_name' }],
      requestedPredicates: [{ name: 'age', pType: '>=', pValue: 18 }],
    });

    expect(exchange.id).toBeDefined();
    expect(exchange.connectionId).toBe('connection-2');
    expect(exchange.state).toBe(PresentationExchangeState.RequestSent);
    await expect(adapter.getPresentation(exchange.id)).resolves.toEqual(
      exchange,
    );
  });

  it('should resolve connection operations with in-memory state by default', async () => {
    const invitation = await adapter.createInvitation({
      alias: 'Acme',
      multiUse: true,
      label: 'Acme Wallet',
    });

    expect(invitation.invitationId).toBeDefined();
    expect(invitation.invitationUrl).toContain(invitation.invitationId);
    expect(invitation.connectionId).toBeDefined();

    if (!invitation.connectionId) {
      throw new Error('Expected invitation.connectionId to be defined');
    }

    await expect(
      adapter.getById(invitation.connectionId),
    ).resolves.toMatchObject({
      id: invitation.connectionId,
      state: ConnectionState.Invitation,
      alias: 'Acme',
      theirLabel: 'Acme Wallet',
    });

    const acceptedConnection = await adapter.acceptInvitation(
      invitation.invitationUrl,
    );

    expect(acceptedConnection.id).toBe(invitation.connectionId);
    expect(acceptedConnection.state).toBe(ConnectionState.Active);

    await expect(
      adapter.list({ state: ConnectionState.Active, alias: 'Acme' }),
    ).resolves.toEqual([acceptedConnection]);
  });

  it('should reject methods from every port when configured for failure', async () => {
    const failureError = new TimeoutError('mock timeout');

    adapter.configure({
      mode: 'failure',
      failureError,
    });

    await expect(
      adapter.offerCredential({
        format: CredentialFormat.AnonCreds,
        attributes: [{ name: 'given_name', value: 'Avery' }],
      }),
    ).rejects.toBe(failureError);
    await expect(
      adapter.requestPresentation({
        name: 'Proof request',
        requestedAttributes: [{ name: 'given_name' }],
      }),
    ).rejects.toBe(failureError);
    await expect(adapter.acceptOffer('exchange-id')).rejects.toBe(failureError);
    await expect(adapter.createInvitation({ alias: 'Acme' })).rejects.toBe(
      failureError,
    );
    await expect(adapter.revoke('credential-id')).rejects.toBe(failureError);
  });

  it('should delay the success path when configured for delayed mode', async () => {
    jest.useFakeTimers();
    adapter.configure({
      mode: 'delayed',
      delayMs: 50,
    });

    let resolved = false;
    const promise = adapter
      .offerCredential({
        format: CredentialFormat.SdJwtVc,
        attributes: [{ name: 'given_name', value: 'Avery' }],
      })
      .then((exchange) => {
        resolved = true;
        return exchange;
      });

    await jest.advanceTimersByTimeAsync(49);
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    const exchange = await promise;

    expect(resolved).toBe(true);
    expect(exchange.state).toBe(CredentialExchangeState.OfferSent);
  });

  it('should record calls and filter them by method name', async () => {
    const offerRequest = {
      format: CredentialFormat.AnonCreds,
      attributes: [{ name: 'given_name', value: 'Avery' }],
    };
    const filters = { alias: 'Acme' };

    await adapter.offerCredential(offerRequest);
    await adapter.list(filters);

    const calls = adapter.getCalls();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: 'offerCredential',
      args: [offerRequest],
    });
    expect(calls[0].timestamp).toBeInstanceOf(Date);
    expect(adapter.getCalls('list')).toEqual([
      expect.objectContaining({
        method: 'list',
        args: [filters],
      }),
    ]);
  });

  it('should reset call history and in-memory state while preserving configuration', async () => {
    const exchange = await adapter.offerCredential({
      format: CredentialFormat.AnonCreds,
      attributes: [{ name: 'given_name', value: 'Avery' }],
    });

    adapter.configure({
      mode: 'success',
      failureError: new ConnectorUnavailableError('configured failure'),
    });
    adapter.reset();

    expect(adapter.getCalls()).toEqual([]);
    await expect(adapter.getExchange(exchange.id)).rejects.toBeInstanceOf(
      ValidationError,
    );

    adapter.configure({ mode: 'failure' });

    await expect(
      adapter.requestPresentation({
        name: 'Proof request',
        requestedAttributes: [{ name: 'given_name' }],
      }),
    ).rejects.toBeInstanceOf(ConnectorUnavailableError);
  });
});
