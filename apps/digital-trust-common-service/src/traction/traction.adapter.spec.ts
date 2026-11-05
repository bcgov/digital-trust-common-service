import {
  CredentialFormat,
  ConnectionState,
  ConnectorUnavailableError,
  TimeoutError,
  ValidationError,
} from '@app/credential-ports';
import { NotImplementedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';

import { TractionDefinitionRegistration } from './traction-definition-registration.service';
import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';
import { TractionAdapter } from './traction.adapter';

function makeInvitationUrl(invitation: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(invitation)).toString('base64url');

  return `https://traction.example.com?oob=${encoded}`;
}

describe('TractionAdapter', () => {
  let adapter: TractionAdapter;
  let mockRegister: jest.Mock;
  let mockRequest: jest.Mock;
  let mockGetToken: jest.Mock;

  beforeEach(async () => {
    mockRegister = jest.fn();
    mockRequest = jest.fn();
    mockGetToken = jest.fn().mockResolvedValue('token-1');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TractionAdapter,
        { provide: TractionDefinitionRegistration, useValue: {} },
        {
          provide: AdapterRegistry,
          useValue: { register: mockRegister },
        },
        {
          provide: TractionHttpClient,
          useValue: { request: mockRequest },
        },
        {
          provide: TractionTokenManager,
          useValue: { getToken: mockGetToken },
        },
      ],
    }).compile();

    adapter = module.get(TractionAdapter);
  });

  it('advertises the traction connector type and AnonCreds as its supported format', () => {
    expect(adapter.connectorType).toBe('traction');
    expect(adapter.supportedFormats).toEqual(['anoncreds']);
  });

  it('registers itself with the AdapterRegistry on module init', () => {
    adapter.onModuleInit();

    expect(mockRegister).toHaveBeenCalledWith(adapter);
  });

  it('sends a native AnonCreds v2 offer with auto issuance and retained records', async () => {
    mockRequest.mockResolvedValue({
      data: {
        cred_ex_id: 'exchange',
        state: 'offer_sent',
        connection_id: 'connection',
        created_at: 'created',
        updated_at: 'updated',
      },
    });
    const exchange = await adapter.offerCredential(
      {
        tenantId: 'tenant',
        connectorId: 'connector',
        endpointUrl: 'https://traction.example.com',
        credentials: {},
      },
      {
        format: CredentialFormat.AnonCreds,
        connectionId: 'connection',
        credentialDefinitionId: 'external-definition',
        attributes: [{ name: 'name', value: 'Alice' }],
      },
    );
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://traction.example.com/issue-credential-2.0/send-offer',
        data: expect.objectContaining({
          auto_issue: true,
          auto_remove: false,
          filter: { anoncreds: { cred_def_id: 'external-definition' } },
          credential_preview: expect.objectContaining({
            attributes: [{ name: 'name', value: 'Alice' }],
          }),
        }),
      }),
      false,
    );
    expect(exchange.state).toBe('offer-sent');
    expect(exchange.externalId).toBe('exchange');
  });

  it('reads and maps a retained credential exchange', async () => {
    mockRequest.mockResolvedValue({
      data: {
        cred_ex_record: {
          cred_ex_id: 'exchange',
          state: 'credential_issued',
          created_at: 'created',
          updated_at: 'updated',
        },
        anoncreds: null,
      },
    });
    await expect(
      adapter.getExchange(
        {
          tenantId: 'tenant',
          connectorId: 'connector',
          endpointUrl: 'https://traction.example.com',
          credentials: {},
        },
        'exchange',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        state: 'credential-issued',
        id: 'exchange',
      }),
    );
  });

  it('honors explicitly disabled automatic issuance while retaining records', async () => {
    mockRequest.mockResolvedValue({
      data: { cred_ex_id: 'exchange', state: 'offer_sent' },
    });
    await adapter.offerCredential(
      {
        tenantId: 'tenant',
        connectorId: 'connector',
        endpointUrl: 'https://traction.example.com',
        credentials: {},
      },
      {
        format: CredentialFormat.AnonCreds,
        connectionId: 'connection',
        credentialDefinitionId: 'external-definition',
        attributes: [{ name: 'name', value: 'Alice' }],
        autoIssue: false,
      },
    );
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          auto_issue: false,
          auto_remove: false,
          auto_remove_on_failure: false,
        }),
      }),
      false,
    );
  });

  describe('offer and exchange validation', () => {
    const context = {
      tenantId: 'tenant',
      connectorId: 'connector',
      endpointUrl: 'https://traction.example.com',
      credentials: {},
    };
    const offer = {
      format: CredentialFormat.AnonCreds,
      connectionId: 'connection',
      credentialDefinitionId: 'external-definition',
      attributes: [{ name: 'name', value: 'Alice' }],
    };

    it.each(['getExchange', 'getById'] as const)(
      'preserves a backend 404 as distinguishable from an outage for %s',
      async (method) => {
        mockRequest.mockRejectedValue({
          isAxiosError: true,
          message: 'Missing record',
          response: { status: 404 },
        });
        await expect(adapter[method](context, 'missing')).rejects.toMatchObject(
          {
            code: 'BACKEND_NOT_FOUND',
            context: { connectorId: context.connectorId },
          },
        );
      },
    );

    it.each([
      { format: CredentialFormat.JsonLd },
      { connectionId: undefined },
      { credentialDefinitionId: undefined },
    ])(
      'rejects unsupported or incomplete offers before authentication: %p',
      async (change) => {
        await expect(
          adapter.offerCredential(context, { ...offer, ...change }),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(mockGetToken).not.toHaveBeenCalled();
        expect(mockRequest).not.toHaveBeenCalled();
      },
    );

    it('preserves a supplied offer comment and the native preview attributes', async () => {
      const attributes = [{ name: 'name', value: 'Alice' }];
      mockRequest.mockResolvedValue({
        data: {
          cred_ex_id: 'exchange',
          state: 'offer_sent',
          connection_id: 'connection',
          cred_preview: { attributes },
          created_at: 'created',
          updated_at: 'updated',
        },
      });
      const exchange = await adapter.offerCredential(context, {
        ...offer,
        comment: 'Employee credential',
      });
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ comment: 'Employee credential' }),
          maxRedirects: 0,
        }),
        false,
      );
      expect(exchange).toEqual({
        id: 'exchange',
        externalId: 'exchange',
        connectionId: 'connection',
        state: 'offer-sent',
        format: CredentialFormat.AnonCreds,
        attributes,
        createdAt: 'created',
        updatedAt: 'updated',
        error: undefined,
      });
    });

    it.each([
      undefined,
      {},
      { cred_ex_id: 'exchange', state: null },
      { state: 'offer_sent' },
      { cred_ex_id: 'exchange', state: 'unrecognized-state' },
    ])('rejects malformed retained exchange records: %p', async (record) => {
      mockRequest.mockResolvedValue({ data: { cred_ex_record: record } });
      await expect(
        adapter.getExchange(context, 'exchange'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('encodes the retained exchange ID and returns backend failure details', async () => {
      mockRequest.mockResolvedValue({
        data: {
          cred_ex_record: {
            cred_ex_id: 'exchange/id',
            state: 'abandoned',
            error_msg: 'Holder declined',
          },
        },
      });
      const exchange = await adapter.getExchange(context, 'exchange/id');
      expect(mockGetToken).toHaveBeenCalledWith(context);
      expect(mockRequest).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://traction.example.com/issue-credential-2.0/records/exchange%2Fid',
        headers: { Authorization: 'Bearer token-1' },
        maxRedirects: 0,
      });
      expect(exchange).toMatchObject({
        id: 'exchange/id',
        state: 'abandoned',
        attributes: [],
        error: 'Holder declined',
      });
    });

    it('propagates an uncertain offer failure without replaying submission', async () => {
      const error = new TimeoutError('Offer response unavailable');
      mockRequest.mockRejectedValue(error);
      await expect(adapter.offerCredential(context, offer)).rejects.toBe(error);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith(expect.anything(), false);
    });

    it('maps backend read errors without issuing a write', async () => {
      mockRequest.mockRejectedValue({
        isAxiosError: true,
        message: 'Backend unavailable',
        response: { status: 503 },
      });
      await expect(
        adapter.getExchange(context, 'exchange'),
      ).rejects.toBeInstanceOf(ConnectorUnavailableError);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  it('rejects remaining unimplemented port methods with NotImplementedException', async () => {
    const context = {
      connectorId: 'connector-1',
      tenantId: 'tenant-1',
      endpointUrl: 'https://traction.example.com',
      credentials: {},
    };

    await expect(
      adapter.requestPresentation(context, {
        requestedAttributes: [],
        requestedPredicates: [],
        name: '',
      }),
    ).rejects.toBeInstanceOf(NotImplementedException);
    await expect(adapter.getPresentation(context, 'id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(adapter.acceptOffer(context, 'id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(adapter.rejectOffer(context, 'id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(adapter.revoke(context, 'id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(adapter.batchRevoke(context, ['id'])).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  describe('createInvitation', () => {
    const context = {
      connectorId: 'connector-1',
      tenantId: 'tenant-1',
      endpointUrl: 'https://traction.example.com',
      credentials: { apiKey: 'key-1', tractionTenantId: 'traction-tenant-1' },
    };

    it('creates an out-of-band invitation and returns its id and url', async () => {
      mockRequest.mockResolvedValue({
        data: {
          state: 'initial',
          trace: false,
          invi_msg_id: 'invi-msg-1',
          oob_id: 'oob-1',
          invitation: { '@id': 'invi-msg-1' },
          invitation_url: 'https://traction.example.com?oob=abc123',
        },
      });

      const result = await adapter.createInvitation(context, {
        alias: 'test',
        multiUse: true,
      });

      expect(result).toEqual({
        invitationId: 'invi-msg-1',
        invitationUrl: 'https://traction.example.com?oob=abc123',
      });
      expect(mockGetToken).toHaveBeenCalledWith(context);
      expect(mockRequest).toHaveBeenCalledWith({
        method: 'POST',
        url: 'https://traction.example.com/out-of-band/create-invitation',
        params: { multi_use: true },
        headers: { Authorization: 'Bearer token-1' },
        data: {
          accept: ['didcomm/aip1', 'didcomm/aip2;env=rfc19'],
          alias: 'test',
          goal: '',
          goal_code: '',
          handshake_protocols: ['https://didcomm.org/didexchange/1.1'],
          my_label: '',
          protocol_version: '1.1',
          use_public_did: false,
        },
      });
    });

    it('defaults multiUse, alias, goalCode, and label when not provided', async () => {
      mockRequest.mockResolvedValue({
        data: {
          invi_msg_id: 'invi-msg-1',
          invitation_url: 'https://traction.example.com?oob=abc123',
        },
      });

      await adapter.createInvitation(context, {});

      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { multi_use: false },
          data: expect.objectContaining({
            alias: '',
            goal_code: '',
            my_label: '',
          }),
        }),
      );
    });

    it('maps a 422 response to ValidationError', async () => {
      const axiosError = Object.assign(new Error('Unprocessable'), {
        isAxiosError: true,
        response: { status: 422 },
      });
      mockRequest.mockRejectedValue(axiosError);

      await expect(adapter.createInvitation(context, {})).rejects.toThrow(
        ValidationError,
      );
    });

    it('maps a request timeout to TimeoutError', async () => {
      const axiosError = Object.assign(
        new Error('timeout of 30000ms exceeded'),
        {
          isAxiosError: true,
          code: 'ECONNABORTED',
        },
      );
      mockRequest.mockRejectedValue(axiosError);

      await expect(adapter.createInvitation(context, {})).rejects.toThrow(
        TimeoutError,
      );
    });

    it('maps a 5xx response to ConnectorUnavailableError', async () => {
      const axiosError = Object.assign(new Error('Bad Gateway'), {
        isAxiosError: true,
        response: { status: 502 },
      });
      mockRequest.mockRejectedValue(axiosError);

      await expect(adapter.createInvitation(context, {})).rejects.toThrow(
        ConnectorUnavailableError,
      );
    });

    it('propagates a ConnectorUnavailableError thrown by the token manager unchanged', async () => {
      mockGetToken.mockRejectedValue(
        new ConnectorUnavailableError('missing apiKey'),
      );

      await expect(adapter.createInvitation(context, {})).rejects.toThrow(
        'missing apiKey',
      );
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('acceptInvitation', () => {
    const context = {
      connectorId: 'connector-1',
      tenantId: 'tenant-1',
      endpointUrl: 'https://traction.example.com',
      credentials: { apiKey: 'key-1', tractionTenantId: 'traction-tenant-1' },
    };
    const invitation = {
      '@type': 'https://didcomm.org/out-of-band/1.1/invitation',
      '@id': 'invi-1',
    };
    const url = makeInvitationUrl(invitation);

    it('decodes the oob invitation, accepts it, and returns the resulting connection', async () => {
      mockRequest
        .mockResolvedValueOnce({ data: { connection_id: 'conn-1' } })
        .mockResolvedValueOnce({
          data: {
            connection_id: 'conn-1',
            state: 'active',
            alias: 'test',
            their_label: 'jamie',
            created_at: '2026-09-08T23:05:07.503811Z',
            updated_at: '2026-09-08T23:05:07.638608Z',
          },
        });

      const result = await adapter.acceptInvitation(context, url);

      expect(result).toEqual({
        id: 'conn-1',
        externalId: 'conn-1',
        state: 'active',
        alias: 'test',
        protocol: 'didcomm-v1',
        theirLabel: 'jamie',
        createdAt: '2026-09-08T23:05:07.503811Z',
        updatedAt: '2026-09-08T23:05:07.638608Z',
      });
      expect(mockGetToken).toHaveBeenCalledWith(context);
      expect(mockRequest).toHaveBeenNthCalledWith(1, {
        method: 'POST',
        url: 'https://traction.example.com/out-of-band/receive-invitation',
        headers: { Authorization: 'Bearer token-1' },
        data: invitation,
      });
      expect(mockRequest).toHaveBeenNthCalledWith(2, {
        method: 'GET',
        url: 'https://traction.example.com/connections/conn-1',
        headers: { Authorization: 'Bearer token-1' },
      });
    });

    it('rejects with ValidationError when the url has no oob query parameter', async () => {
      await expect(
        adapter.acceptInvitation(
          context,
          'https://traction.example.com/no-oob',
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('rejects with ValidationError when the oob parameter is not valid base64url JSON', async () => {
      await expect(
        adapter.acceptInvitation(
          context,
          'https://traction.example.com?oob=!!!not-json!!!',
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('maps a 5xx response to ConnectorUnavailableError', async () => {
      const axiosError = Object.assign(new Error('Bad Gateway'), {
        isAxiosError: true,
        response: { status: 502 },
      });
      mockRequest.mockRejectedValue(axiosError);

      await expect(adapter.acceptInvitation(context, url)).rejects.toThrow(
        ConnectorUnavailableError,
      );
    });
  });

  describe('list', () => {
    const context = {
      connectorId: 'connector-1',
      tenantId: 'tenant-1',
      endpointUrl: 'https://traction.example.com',
      credentials: { apiKey: 'key-1', tractionTenantId: 'traction-tenant-1' },
    };

    it('lists connections matching the given filters', async () => {
      mockRequest.mockResolvedValue({
        data: {
          results: [
            {
              connection_id: 'conn-1',
              state: 'active',
              alias: 'test',
              their_label: 'jamie',
              invitation_msg_id: 'invi-msg-1',
              created_at: '2026-09-08T23:05:07.503811Z',
              updated_at: '2026-09-08T23:05:07.638608Z',
            },
          ],
        },
      });

      const result = await adapter.list(context, {
        invitationId: 'invi-msg-1',
        state: ConnectionState.Active,
        alias: 'test',
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual([
        {
          id: 'conn-1',
          externalId: 'conn-1',
          state: 'active',
          alias: 'test',
          protocol: 'didcomm-v1',
          theirLabel: 'jamie',
          invitationId: 'invi-msg-1',
          createdAt: '2026-09-08T23:05:07.503811Z',
          updatedAt: '2026-09-08T23:05:07.638608Z',
        },
      ]);
      expect(mockGetToken).toHaveBeenCalledWith(context);
      expect(mockRequest).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://traction.example.com/connections',
        headers: { Authorization: 'Bearer token-1' },
        params: {
          invitation_msg_id: 'invi-msg-1',
          alias: 'test',
          state: 'active',
          limit: 10,
          offset: 0,
        },
      });
    });

    it('maps a 5xx response to ConnectorUnavailableError', async () => {
      const axiosError = Object.assign(new Error('Bad Gateway'), {
        isAxiosError: true,
        response: { status: 502 },
      });
      mockRequest.mockRejectedValue(axiosError);

      await expect(adapter.list(context, {})).rejects.toThrow(
        ConnectorUnavailableError,
      );
    });
  });

  describe('getById', () => {
    const context = {
      connectorId: 'connector-1',
      tenantId: 'tenant-1',
      endpointUrl: 'https://traction.example.com',
      credentials: { apiKey: 'key-1', tractionTenantId: 'traction-tenant-1' },
    };

    it('fetches and maps a single connection', async () => {
      mockRequest.mockResolvedValue({
        data: {
          connection_id: 'conn-1',
          state: 'completed',
          created_at: '2026-09-08T23:05:07.503811Z',
          updated_at: '2026-09-08T23:05:07.638608Z',
        },
      });

      const result = await adapter.getById(context, 'conn-1');

      expect(result).toEqual({
        id: 'conn-1',
        externalId: 'conn-1',
        state: 'completed',
        alias: undefined,
        protocol: 'didcomm-v1',
        theirLabel: undefined,
        theirDid: undefined,
        createdAt: '2026-09-08T23:05:07.503811Z',
        updatedAt: '2026-09-08T23:05:07.638608Z',
      });
      expect(mockRequest).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://traction.example.com/connections/conn-1',
        headers: { Authorization: 'Bearer token-1' },
      });
    });

    it('maps a 5xx response to ConnectorUnavailableError', async () => {
      const axiosError = Object.assign(new Error('Bad Gateway'), {
        isAxiosError: true,
        response: { status: 502 },
      });
      mockRequest.mockRejectedValue(axiosError);

      await expect(adapter.getById(context, 'conn-1')).rejects.toThrow(
        ConnectorUnavailableError,
      );
    });
  });

  describe('deleteById', () => {
    const context = {
      connectorId: 'connector-1',
      tenantId: 'tenant-1',
      endpointUrl: 'https://traction.example.com',
      credentials: { apiKey: 'key-1', tractionTenantId: 'traction-tenant-1' },
    };

    it('deletes a connection on the connector', async () => {
      mockRequest.mockResolvedValue({ data: {} });

      await adapter.deleteById(context, 'conn-1');

      expect(mockGetToken).toHaveBeenCalledWith(context);
      expect(mockRequest).toHaveBeenCalledWith({
        method: 'DELETE',
        url: 'https://traction.example.com/connections/conn-1',
        headers: { Authorization: 'Bearer token-1' },
      });
    });

    it('maps a 5xx response to ConnectorUnavailableError', async () => {
      const axiosError = Object.assign(new Error('Bad Gateway'), {
        isAxiosError: true,
        response: { status: 502 },
      });
      mockRequest.mockRejectedValue(axiosError);

      await expect(adapter.deleteById(context, 'conn-1')).rejects.toThrow(
        ConnectorUnavailableError,
      );
    });

    it('treats a 404 response as already deleted rather than an error', async () => {
      const axiosError = Object.assign(new Error('Not Found'), {
        isAxiosError: true,
        response: { status: 404 },
      });
      mockRequest.mockRejectedValue(axiosError);

      await expect(
        adapter.deleteById(context, 'conn-1'),
      ).resolves.toBeUndefined();
    });
  });
});
