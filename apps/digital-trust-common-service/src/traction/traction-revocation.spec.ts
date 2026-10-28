import {
  BackendNotFoundError,
  ConnectorUnavailableError,
  TimeoutError,
  ValidationError,
} from '@app/credential-ports';
import { Test } from '@nestjs/testing';
import { AxiosRequestConfig } from 'axios';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';

import { TractionDefinitionRegistration } from './traction-definition-registration.service';
import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';
import { TractionAdapter } from './traction.adapter';

describe('Traction revocation', () => {
  const context = {
    tenantId: 'tenant',
    connectorId: 'connector',
    endpointUrl: 'https://agent.example',
    credentials: {},
  };
  const record = (
    id = 'exchange-1',
    index = '1',
    registry = 'registry/old',
  ) => ({
    cred_ex_id: id,
    cred_rev_id: index,
    rev_reg_id: registry,
    state: 'issued',
  });
  let adapter: TractionAdapter;
  const request = jest.fn<unknown, [AxiosRequestConfig, boolean?]>();
  const getToken = jest.fn();
  let records: Map<string, ReturnType<typeof record>>;
  let ledger: Map<string, number[]>;
  let pending: Map<string, Set<number>>;
  let confirmPublication: boolean;
  let failQueueId: string | undefined;
  let losePublishResponse: boolean;

  beforeEach(async () => {
    request.mockReset();
    getToken.mockReset().mockResolvedValue('wallet-token');
    records = new Map([['exchange-1', record()]]);
    ledger = new Map([['registry/old', []]]);
    pending = new Map();
    confirmPublication = true;
    failQueueId = undefined;
    losePublishResponse = false;
    request.mockImplementation((config: AxiosRequestConfig) => {
      if (config.method === 'GET') {
        if (config.url?.endsWith('/credential-record')) {
          return {
            data: {
              result: records.get(config.params.cred_ex_id as string),
            },
          };
        }
        const registry = [...ledger.keys()].find((id) =>
          config.url?.includes(`/registry/${encodeURIComponent(id)}/`),
        );
        return {
          data: {
            rev_reg_delta: {
              value: { accum: 'accumulator', revoked: ledger.get(registry!) },
            },
          },
        };
      }
      if (config.url?.endsWith('/revoke')) {
        if (config.data.cred_rev_id === failQueueId) {
          throw Object.assign(new Error('Backend unavailable'), {
            isAxiosError: true,
            response: { status: 503 },
          });
        }
        const registry = config.data.rev_reg_id as string;
        const queued = pending.get(registry) ?? new Set<number>();
        queued.add(Number(config.data.cred_rev_id));
        pending.set(registry, queued);
        return { data: {} };
      }
      const selected = config.data.rrid2crid as Record<string, string[]>;
      if (confirmPublication) {
        for (const [registry, indexes] of Object.entries(selected)) {
          const revoked = indexes.map(Number);
          ledger.set(registry, [...(ledger.get(registry) ?? []), ...revoked]);
          for (const index of revoked) {
            pending.get(registry)?.delete(index);
          }
          for (const credential of records.values()) {
            if (
              credential.rev_reg_id === registry &&
              indexes.includes(credential.cred_rev_id)
            ) {
              credential.state = 'revoked';
            }
          }
        }
      }
      if (losePublishResponse) {
        losePublishResponse = false;
        throw Object.assign(new Error('Timeout'), {
          isAxiosError: true,
          code: 'ECONNABORTED',
        });
      }
      // ACA-Py returns this map even when the ledger update did not succeed.
      return { data: { rrid2crid: selected } };
    });
    const module = await Test.createTestingModule({
      providers: [
        TractionAdapter,
        { provide: AdapterRegistry, useValue: { register: jest.fn() } },
        { provide: TractionDefinitionRegistration, useValue: {} },
        { provide: TractionHttpClient, useValue: { request } },
        { provide: TractionTokenManager, useValue: { getToken } },
      ],
    }).compile();
    adapter = module.get(TractionAdapter);
  });

  const writes = () =>
    request.mock.calls.filter(([config]) => config.method === 'POST');

  it('resolves an exchange in its wallet, queues its original registry and confirms publication', async () => {
    await expect(adapter.revoke(context, 'exchange-1')).resolves.toEqual({
      credentialId: 'exchange-1',
      revoked: true,
      revokedAt: expect.any(String),
    });
    expect(getToken).toHaveBeenCalledWith(context);
    expect(request).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      url: `${context.endpointUrl}/anoncreds/revocation/credential-record`,
      params: { cred_ex_id: 'exchange-1' },
      headers: { Authorization: 'Bearer wallet-token' },
      maxRedirects: 0,
    });
    expect(writes()).toEqual([
      [
        expect.objectContaining({
          url: `${context.endpointUrl}/anoncreds/revocation/revoke`,
          data: {
            rev_reg_id: 'registry/old',
            cred_rev_id: '1',
            publish: false,
            notify: false,
          },
        }),
        false,
      ],
      [
        expect.objectContaining({
          url: `${context.endpointUrl}/anoncreds/revocation/publish-revocations`,
          data: { rrid2crid: { 'registry/old': ['1'] } },
        }),
        false,
      ],
    ]);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: `${context.endpointUrl}/anoncreds/revocation/registry/registry%2Fold/issued/indy_recs`,
      }),
    );
    for (const [config] of request.mock.calls) {
      expect(config.headers).toEqual({ Authorization: 'Bearer wallet-token' });
      expect(config.maxRedirects).toBe(0);
    }
  });

  it('publishes once across registries, preserves input order and deduplicates writes', async () => {
    records.set('exchange-2', record('exchange-2', '2'));
    records.set('exchange-3', record('exchange-3', '1', 'registry/new'));
    ledger.set('registry/new', []);
    pending.set('registry/old', new Set([99]));
    const ids = ['exchange-2', 'exchange-3', 'exchange-1', 'exchange-2'];
    const result = await adapter.batchRevoke(context, ids);
    expect(result.map((item) => item.credentialId)).toEqual(ids);
    expect(result.every((item) => item.revoked)).toBe(true);
    expect(new Set(result.map((item) => item.revokedAt)).size).toBe(1);
    expect(Number.isNaN(Date.parse(result[0].revokedAt!))).toBe(false);
    expect(writes()).toHaveLength(4);
    expect(writes()[3][0].data).toEqual({
      rrid2crid: { 'registry/old': ['2', '1'], 'registry/new': ['1'] },
    });
    expect(pending.get('registry/old')).toEqual(new Set([99]));
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(
      request.mock.calls.filter(([config]) => config.method === 'GET'),
    ).toHaveLength(7);
  });

  it('does not contact the backend for an empty batch', async () => {
    await expect(adapter.batchRevoke(context, [])).resolves.toEqual([]);
    expect(getToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['', '   '])(
    'rejects empty ids before any request: %j',
    async (id) => {
      await expect(
        adapter.batchRevoke(context, ['exchange-1', id]),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(getToken).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    { ...record(), cred_ex_id: 'another-exchange' },
    { ...record(), rev_reg_id: '' },
    { ...record(), cred_rev_id: '' },
    { ...record(), cred_rev_id: '0' },
    { ...record(), cred_rev_id: '1.5' },
    { ...record(), cred_rev_id: '9007199254740992' },
    { ...record(), state: 'unexpected' },
  ])('rejects an invalid or mismatched issuer record: %j', async (result) => {
    request.mockResolvedValueOnce({ data: { result } });
    await expect(adapter.revoke(context, 'exchange-1')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(writes()).toHaveLength(0);
  });

  it('preflights all records before writing even when a later id is missing', async () => {
    await expect(
      adapter.batchRevoke(context, ['exchange-1', 'missing']),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(writes()).toHaveLength(0);
  });

  it.each([
    undefined,
    { value: { accum: '', revoked: [] } },
    { value: { accum: 'accumulator', revoked: undefined } },
    { value: { accum: 'accumulator', revoked: ['1'] } },
    { value: { accum: 'accumulator', revoked: [-1] } },
  ])('rejects malformed ledger evidence: %j', async (delta) => {
    request
      .mockResolvedValueOnce({ data: { result: record() } })
      .mockResolvedValueOnce({ data: { rev_reg_delta: delta } });
    await expect(adapter.revoke(context, 'exchange-1')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(writes()).toHaveLength(0);
  });

  it.each(['issued', 'revoked'])(
    'accepts ledger-confirmed revocation without another write (wallet %s)',
    async (state) => {
      records.get('exchange-1')!.state = state;
      ledger.set('registry/old', [1]);
      await expect(
        adapter.revoke(context, 'exchange-1'),
      ).resolves.toMatchObject({
        revoked: true,
      });
      expect(writes()).toHaveLength(0);
    },
  );

  it('excludes already confirmed ids from a mixed batch publication', async () => {
    ledger.set('registry/old', [1]);
    records.set('exchange-2', record('exchange-2', '2'));
    const results = await adapter.batchRevoke(context, [
      'exchange-1',
      'exchange-2',
    ]);
    expect(results).toHaveLength(2);
    expect(writes()).toHaveLength(2);
    expect(writes()[1][0].data).toEqual({
      rrid2crid: { 'registry/old': ['2'] },
    });
  });

  it('rejects a wallet-only revocation without attempting a blind repair', async () => {
    records.get('exchange-1')!.state = 'revoked';
    await expect(adapter.revoke(context, 'exchange-1')).rejects.toMatchObject({
      code: 'CONNECTOR_UNAVAILABLE',
      message: expect.stringContaining('reconcile the backend registry'),
    });
    expect(writes()).toHaveLength(0);
  });

  it('does not mistake the publication response for ledger confirmation', async () => {
    confirmPublication = false;
    await expect(adapter.revoke(context, 'exchange-1')).rejects.toMatchObject({
      code: 'CONNECTOR_UNAVAILABLE',
      message: expect.stringContaining('not confirmed on the ledger'),
    });
    expect(writes()).toHaveLength(2);
  });

  it('recovers a lost successful publication response by reading the ledger on retry', async () => {
    losePublishResponse = true;
    await expect(adapter.revoke(context, 'exchange-1')).rejects.toBeInstanceOf(
      TimeoutError,
    );
    expect(writes()).toHaveLength(2);
    request.mockClear();
    await expect(adapter.revoke(context, 'exchange-1')).resolves.toMatchObject({
      revoked: true,
    });
    expect(writes()).toHaveLength(0);
  });

  it('leaves a partially queued batch pending and can retry it without publishing other ids', async () => {
    records.set('exchange-2', record('exchange-2', '2'));
    failQueueId = '2';
    await expect(
      adapter.batchRevoke(context, ['exchange-1', 'exchange-2']),
    ).rejects.toBeInstanceOf(ConnectorUnavailableError);
    expect(pending.get('registry/old')).toEqual(new Set([1]));
    expect(writes()).toHaveLength(2);
    expect(writes().every(([config]) => config.url?.endsWith('/revoke'))).toBe(
      true,
    );
    failQueueId = undefined;
    request.mockClear();
    await expect(
      adapter.batchRevoke(context, ['exchange-1', 'exchange-2']),
    ).resolves.toHaveLength(2);
    expect(writes()).toHaveLength(3);
    expect(ledger.get('registry/old')).toEqual([1, 2]);
  });

  it.each([
    [400, ValidationError],
    [401, ValidationError],
    [403, ValidationError],
    [404, BackendNotFoundError],
    [429, ConnectorUnavailableError],
    [503, ConnectorUnavailableError],
  ])('maps HTTP %s to the adapter error family', async (status, errorType) => {
    request.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Backend rejected request',
      response: { status },
    });
    await expect(adapter.revoke(context, 'exchange-1')).rejects.toBeInstanceOf(
      errorType,
    );
    expect(writes()).toHaveLength(0);
  });

  it('maps an open circuit without attempting writes', async () => {
    request.mockRejectedValueOnce(new Error('Circuit open'));
    await expect(adapter.revoke(context, 'exchange-1')).rejects.toBeInstanceOf(
      ConnectorUnavailableError,
    );
    expect(writes()).toHaveLength(0);
  });

  it('uses the newly resolved connector wallet for every call without caching ids across tenants', async () => {
    await adapter.revoke(context, 'exchange-1');
    request.mockClear();
    ledger.set('registry/old', []);
    records.get('exchange-1')!.state = 'issued';
    getToken.mockResolvedValueOnce('other-wallet-token');
    const other = {
      ...context,
      tenantId: 'other-tenant',
      connectorId: 'other-connector',
      endpointUrl: 'https://other-agent.example',
    };
    await adapter.revoke(other, 'exchange-1');
    expect(getToken).toHaveBeenLastCalledWith(other);
    for (const [config] of request.mock.calls) {
      expect(config.url).toMatch(/^https:\/\/other-agent\.example\//);
      expect(config.headers).toEqual({
        Authorization: 'Bearer other-wallet-token',
      });
    }
    expect(writes()).toHaveLength(2);
  });
});
