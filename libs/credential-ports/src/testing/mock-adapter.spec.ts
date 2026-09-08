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
import { ConnectorContext } from '../ports/connector-context';

import { MockAdapter } from './mock-adapter';

const context: ConnectorContext = {
  connectorId: 'connector-1',
  tenantId: 'tenant-1',
  endpointUrl: 'https://mock.local',
  credentials: {},
};

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

  it('should keep capabilities fixed after construction', () => {
    // configure() takes MockAdapterBehaviour, so passing a capability key is a
    // compile error rather than a silently ignored no-op.
    adapter.configure({ mode: 'failure' });

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
    const exchange = await adapter.offerCredential(context, {
      connectionId: 'connection-1',
      format: CredentialFormat.AnonCreds,
      attributes: [{ name: 'given_name', value: 'Avery' }],
      autoIssue: true,
    });

    expect(exchange.id).toBeDefined();
    expect(exchange.connectionId).toBe('connection-1');
    expect(exchange.state).toBe(CredentialExchangeState.CredentialIssued);

    await expect(adapter.getExchange(context, exchange.id)).resolves.toEqual(
      exchange,
    );

    const acceptedExchange = await adapter.acceptOffer(context, exchange.id);

    expect(acceptedExchange.id).toBe(exchange.id);
    expect(acceptedExchange.state).toBe(CredentialExchangeState.Done);

    await expect(adapter.getExchange(context, exchange.id)).resolves.toEqual(
      acceptedExchange,
    );

    const rejectedExchange = await adapter.offerCredential(context, {
      format: CredentialFormat.JsonLd,
      attributes: [{ name: 'family_name', value: 'Nguyen' }],
    });

    await expect(
      adapter.rejectOffer(context, rejectedExchange.id),
    ).resolves.toBeUndefined();
    await expect(
      adapter.getExchange(context, rejectedExchange.id),
    ).resolves.toMatchObject({
      id: rejectedExchange.id,
      state: CredentialExchangeState.Abandoned,
      error: 'Offer rejected',
    });

    await expect(adapter.revoke(context, exchange.id)).resolves.toMatchObject({
      credentialId: exchange.id,
      revoked: true,
    });
    await expect(
      adapter.batchRevoke(context, [exchange.id, rejectedExchange.id]),
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
    const exchange = await adapter.requestPresentation(context, {
      connectionId: 'connection-2',
      name: 'Proof request',
      requestedAttributes: [{ name: 'given_name' }],
      requestedPredicates: [{ name: 'age', pType: '>=', pValue: 18 }],
    });

    expect(exchange.id).toBeDefined();
    expect(exchange.connectionId).toBe('connection-2');
    expect(exchange.state).toBe(PresentationExchangeState.RequestSent);
    await expect(
      adapter.getPresentation(context, exchange.id),
    ).resolves.toEqual(exchange);
  });

  it('should resolve connection operations with in-memory state by default', async () => {
    const invitation = await adapter.createInvitation(context, {
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
      adapter.getById(context, invitation.connectionId),
    ).resolves.toMatchObject({
      id: invitation.connectionId,
      state: ConnectionState.Invitation,
      alias: 'Acme',
      theirLabel: 'Acme Wallet',
    });

    const acceptedConnection = await adapter.acceptInvitation(
      context,
      invitation.invitationUrl,
    );

    expect(acceptedConnection.id).toBe(invitation.connectionId);
    expect(acceptedConnection.state).toBe(ConnectionState.Active);

    await expect(
      adapter.list(context, { state: ConnectionState.Active, alias: 'Acme' }),
    ).resolves.toEqual([acceptedConnection]);
  });

  it('should reject methods from every port when configured for failure', async () => {
    const failureError = new TimeoutError('mock timeout');

    adapter.configure({
      mode: 'failure',
      failureError,
    });

    await expect(
      adapter.offerCredential(context, {
        format: CredentialFormat.AnonCreds,
        attributes: [{ name: 'given_name', value: 'Avery' }],
      }),
    ).rejects.toBe(failureError);
    await expect(
      adapter.requestPresentation(context, {
        name: 'Proof request',
        requestedAttributes: [{ name: 'given_name' }],
      }),
    ).rejects.toBe(failureError);
    await expect(adapter.acceptOffer(context, 'exchange-id')).rejects.toBe(
      failureError,
    );
    await expect(
      adapter.createInvitation(context, { alias: 'Acme' }),
    ).rejects.toBe(failureError);
    await expect(adapter.revoke(context, 'credential-id')).rejects.toBe(
      failureError,
    );
  });

  it('should delay the success path when configured for delayed mode', async () => {
    jest.useFakeTimers();
    adapter.configure({
      mode: 'delayed',
      delayMs: 50,
    });

    let resolved = false;
    const promise = adapter
      .offerCredential(context, {
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

    await adapter.offerCredential(context, offerRequest);
    await adapter.list(context, filters);

    const calls = adapter.getCalls();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: 'offerCredential',
      args: [context, offerRequest],
    });
    expect(calls[0].timestamp).toBeInstanceOf(Date);
    expect(adapter.getCalls('list')).toEqual([
      expect.objectContaining({
        method: 'list',
        args: [context, filters],
      }),
    ]);
  });

  it('should reset call history and in-memory state while preserving configuration', async () => {
    const exchange = await adapter.offerCredential(context, {
      format: CredentialFormat.AnonCreds,
      attributes: [{ name: 'given_name', value: 'Avery' }],
    });

    adapter.configure({
      mode: 'success',
      failureError: new ConnectorUnavailableError('configured failure'),
    });
    adapter.reset();

    expect(adapter.getCalls()).toEqual([]);
    await expect(
      adapter.getExchange(context, exchange.id),
    ).rejects.toBeInstanceOf(ValidationError);

    adapter.configure({ mode: 'failure' });

    await expect(
      adapter.requestPresentation(context, {
        name: 'Proof request',
        requestedAttributes: [{ name: 'given_name' }],
      }),
    ).rejects.toBeInstanceOf(ConnectorUnavailableError);
  });
});
