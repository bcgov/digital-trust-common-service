import {
  ConnectionState,
  ConnectorUnavailableError,
  TimeoutError,
  ValidationError,
} from '@app/credential-ports';
import { NotImplementedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';

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

  it('rejects every port method with NotImplementedException', async () => {
    const context = {
      connectorId: 'connector-1',
      tenantId: 'tenant-1',
      endpointUrl: 'https://traction.example.com',
      credentials: {},
    };

    await expect(
      adapter.offerCredential(context, {
        format: 'anoncreds' as never,
        attributes: [],
      }),
    ).rejects.toBeInstanceOf(NotImplementedException);
    await expect(adapter.getExchange(context, 'id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
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
        state: ConnectionState.Active,
        alias: 'test',
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual([
        {
          id: 'conn-1',
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
        params: { alias: 'test', state: 'active', limit: 10, offset: 0 },
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
        state: 'completed',
        alias: undefined,
        protocol: 'didcomm-v1',
        theirLabel: undefined,
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
  });
});
