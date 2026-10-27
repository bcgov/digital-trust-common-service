import { randomUUID } from 'crypto';

import { Test } from '@nestjs/testing';
import { AxiosError, AxiosHeaders } from 'axios';

import { RegistrationBackendError } from '../common/registration-backend-error';

import { TractionDefinitionRegistration } from './traction-definition-registration.service';
import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';

describe('Traction artifact registration', () => {
  let service: TractionDefinitionRegistration;
  const request = jest.fn();
  const context = {
    tenantId: 'tenant',
    connectorId: 'connector',
    endpointUrl: 'https://agent.example',
    credentials: {},
  };
  const schema = {
    schema_name: 'employee',
    schema_version: '1.0',
    attr_names: ['name'],
  };
  const ledgerIssuerId = 'W4z1CfasaQiYnosD2LjHfo';
  const walletIssuerId = `did:indy:${ledgerIssuerId}`;
  beforeEach(async () => {
    request.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        TractionDefinitionRegistration,
        { provide: TractionHttpClient, useValue: { request } },
        {
          provide: TractionTokenManager,
          useValue: { getToken: jest.fn().mockResolvedValue('token') },
        },
      ],
    }).compile();
    service = module.get(TractionDefinitionRegistration);
  });

  it.each([
    ['finished', 'finished'],
    ['action', 'action'],
    ['wait', 'wait'],
    ['failed', 'failed'],
    ['transaction_created', 'action'],
    ['request_received', 'action'],
    ['request_sent', 'wait'],
    ['transaction_acked', 'wait'],
    ['transaction_endorsed', 'wait'],
    ['transaction_refused', 'failed'],
    ['transaction_cancelled', 'failed'],
  ])('normalizes backend state %s to %s', async (rawState, state) => {
    request.mockResolvedValueOnce({
      data: {
        schema_state: {
          state: rawState,
          schema_id: `${ledgerIssuerId}:2:employee:1.0`,
          reason: 'backend rejection',
        },
        job_id: 'job',
        registration_metadata: { txn: { transaction_id: 'transaction' } },
      },
    });

    await expect(
      service.publishSchema(context, walletIssuerId, schema),
    ).resolves.toMatchObject({
      state,
      id: `${ledgerIssuerId}:2:employee:1.0`,
      jobId: 'job',
      transactionId: 'transaction',
      ...(state === 'failed' ? { detail: 'backend rejection' } : {}),
    });
  });

  it('rejects unknown backend states instead of guessing registration progress', async () => {
    request.mockResolvedValueOnce({
      data: { schema_state: { state: 'unexpected', schema_id: 'schema' } },
    });

    await expect(
      service.publishSchema(context, walletIssuerId, schema),
    ).rejects.toMatchObject({
      backendCode: 'INVALID_REGISTRATION_RESPONSE',
    });
  });

  it('verifies wallet, public identity, selection and ledger key', async () => {
    request
      .mockResolvedValueOnce({
        data: { settings: { 'wallet.type': 'askar-anoncreds' } },
      })
      .mockResolvedValueOnce({
        data: {
          result: {
            did: walletIssuerId,
            method: 'indy',
            verkey: 'public-key',
          },
        },
      })
      .mockResolvedValueOnce({ data: { verkey: 'public-key' } });
    await expect(
      service.resolveIssuer(context, { method: 'indy' }),
    ).resolves.toBe(walletIssuerId);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { did: walletIssuerId } }),
      true,
    );
  });

  it.each(['askar', undefined])(
    'rejects a non-AnonCreds wallet: %s',
    async (type) => {
      request.mockResolvedValueOnce({
        data: { settings: { 'wallet.type': type } },
      });
      await expect(service.resolveIssuer(context)).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects missing or mismatched issuer instead of creating one', async () => {
    request
      .mockResolvedValueOnce({
        data: { settings: { 'wallet.type': 'askar-anoncreds' } },
      })
      .mockResolvedValueOnce({ data: { result: null } });
    await expect(service.resolveIssuer(context)).rejects.toMatchObject({
      issues: [expect.stringContaining('PUBLIC_ISSUER_DID_REQUIRED')],
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects a ledger key that does not match the public issuer DID', async () => {
    request
      .mockResolvedValueOnce({
        data: { settings: { 'wallet.type': 'askar-anoncreds' } },
      })
      .mockResolvedValueOnce({
        data: {
          result: {
            did: walletIssuerId,
            method: 'indy',
            verkey: 'public-key',
          },
        },
      })
      .mockResolvedValueOnce({ data: { verkey: 'different-key' } });

    await expect(service.resolveIssuer(context)).rejects.toMatchObject({
      issues: [expect.stringContaining('verification key mismatch')],
    });
  });

  it('rejects a resolved schema whose backend identity differs from the requested id', async () => {
    request.mockResolvedValueOnce({
      data: {
        schema_id: 'another-schema',
        schema: { name: 'employee', version: '1.0', attrNames: ['name'] },
      },
    });

    await expect(
      service.resolveSchema(context, 'schema'),
    ).rejects.toMatchObject({
      issues: [expect.stringContaining('Schema could not be resolved')],
    });
  });

  it('returns null when no matching schema is present in the wallet', async () => {
    request.mockResolvedValueOnce({ data: { schema_ids: [] } });

    await expect(
      service.findSchema(context, walletIssuerId, schema),
    ).resolves.toBeNull();
  });

  it('rejects multiple schemas with the same wallet registration identity', async () => {
    request.mockResolvedValueOnce({
      data: { schema_ids: ['schema-a', 'schema-b'] },
    });

    await expect(
      service.findSchema(context, walletIssuerId, schema),
    ).rejects.toMatchObject({
      issues: [expect.stringContaining('Ambiguous schema')],
    });
  });

  it('returns an existing schema only when its attributes match the request', async () => {
    request
      .mockResolvedValueOnce({ data: { schema_ids: ['schema-id'] } })
      .mockResolvedValueOnce({
        data: {
          schema_id: 'schema-id',
          schema: { name: 'employee', version: '1.0', attrNames: ['name'] },
        },
      });

    await expect(
      service.findSchema(context, walletIssuerId, schema),
    ).resolves.toMatchObject({ id: 'schema-id' });

    request
      .mockResolvedValueOnce({ data: { schema_ids: ['schema-id'] } })
      .mockResolvedValueOnce({
        data: {
          schema_id: 'schema-id',
          schema: { name: 'employee', version: '1.0', attrNames: ['other'] },
        },
      });
    await expect(
      service.findSchema(context, walletIssuerId, schema),
    ).rejects.toMatchObject({
      issues: [expect.stringContaining('different attributes')],
    });
  });

  it('publishes schema content without automatic write retries', async () => {
    request.mockResolvedValueOnce({
      data: { schema_state: { state: 'wait' }, job_id: 'schema-job' },
    });
    await expect(
      service.publishSchema(context, 'issuer', schema),
    ).resolves.toEqual({
      id: undefined,
      jobId: 'schema-job',
      state: 'wait',
      transactionId: undefined,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://agent.example/anoncreds/schema',
        method: 'POST',
        data: {
          schema: {
            issuerId: 'issuer',
            name: 'employee',
            version: '1.0',
            attrNames: ['name'],
          },
        },
        maxRedirects: 0,
      }),
      false,
    );
  });

  it('creates a revocable issuer definition and delegates initial setup to ACA-Py', async () => {
    request.mockResolvedValueOnce({
      data: {
        credential_definition_state: {
          state: 'finished',
          credential_definition_id: 'definition-id',
        },
      },
    });
    await expect(
      service.publishDefinition(context, 'issuer', 'schema', {
        tag: 'default',
        status: { revocation: { enabled: true } },
      }),
    ).resolves.toEqual({
      id: 'definition-id',
      jobId: undefined,
      state: 'finished',
      transactionId: undefined,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          credential_definition: {
            issuerId: 'issuer',
            schemaId: 'schema',
            tag: 'default',
          },
          options: { support_revocation: true },
          wait_for_revocation_setup: false,
        },
      }),
      false,
    );
  });

  it.each(['schema', 'credential_definition'] as const)(
    'retains provisional %s identity and endorsement correlation in wait/action responses',
    async (artifact) => {
      request.mockResolvedValueOnce({
        data: {
          job_id: 'backend-job',
          [`${artifact}_state`]: {
            state: 'action',
            [`${artifact}_id`]: 'provisional-id',
          },
          registration_metadata: { txn: { transaction_id: 'endorsement-id' } },
        },
      });
      const submitted =
        artifact === 'schema'
          ? await service.publishSchema(context, 'issuer', schema)
          : await service.publishDefinition(context, 'issuer', 'schema', {
              tag: 'default',
              status: { revocation: { enabled: true } },
            });
      expect(submitted).toEqual({
        state: 'action',
        id: 'provisional-id',
        jobId: 'backend-job',
        transactionId: 'endorsement-id',
      });
    },
  );

  it.each([
    null,
    {},
    { schema_state: null },
    { schema_state: { state: 'other' } },
    { schema_state: { state: 'finished' } },
    { schema_state: { state: 'wait' } },
    { schema_state: { state: 'finished', schema_id: 123 } },
  ])(
    'rejects malformed successful publication responses without losing write uncertainty',
    async (data) => {
      request.mockResolvedValueOnce({ data });
      await expect(
        service.publishSchema(context, 'issuer', schema),
      ).rejects.toMatchObject({
        responseInvalid: true,
        backendCode: 'INVALID_REGISTRATION_RESPONSE',
      });
    },
  );

  it('returns an explicit failed state with a bounded sanitized reason', async () => {
    const secret = randomUUID();
    const securedContext = { ...context, credentials: { token: secret } };
    request.mockResolvedValueOnce({
      data: {
        schema_state: { state: 'failed', reason: `Rejected ${secret}` },
      },
    });
    await expect(
      service.publishSchema(securedContext, 'issuer', schema),
    ).resolves.toMatchObject({
      state: 'failed',
      backendCode: 'REGISTRATION_REJECTED',
      detail: 'Rejected [REDACTED]',
    });
  });

  it('retains safe HTTP diagnostics but not request configuration or credentials', async () => {
    const secret = randomUUID();
    const config = {
      headers: new AxiosHeaders({ Authorization: `Bearer ${secret}` }),
    };
    request.mockRejectedValueOnce(
      new AxiosError(
        'unsafe Axios message',
        'ERR_BAD_REQUEST',
        config,
        undefined,
        {
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config,
          data: {
            error: {
              code: 'INVALID_ISSUER',
              message: `Issuer rejected ${secret}`,
            },
            request: { headers: config.headers },
          },
        },
      ),
    );
    let failure: unknown;
    try {
      await service.publishSchema(
        { ...context, credentials: { apiKey: secret } },
        'issuer',
        schema,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(RegistrationBackendError);
    expect(failure).toMatchObject({
      status: 400,
      backendCode: 'INVALID_ISSUER',
      detail: 'Issuer rejected [REDACTED]',
    });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain('headers');
  });

  it.each([walletIssuerId, ledgerIssuerId])(
    'uses the legacy ledger issuer for schema publication and lookup: %s',
    async (issuerId) => {
      request.mockResolvedValueOnce({
        data: { schema_state: { state: 'finished', schema_id: 'schema' } },
      });
      await service.publishSchema(context, issuerId, schema);
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: {
            schema: {
              issuerId: ledgerIssuerId,
              name: 'employee',
              version: '1.0',
              attrNames: ['name'],
            },
          },
        }),
        false,
      );
      request.mockResolvedValueOnce({ data: { schema_ids: [] } });
      await service.findSchema(context, issuerId, schema);
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: {
            schema_issuer_id: ledgerIssuerId,
            schema_name: 'employee',
            schema_version: '1.0',
          },
        }),
        true,
      );
    },
  );

  it('uses the same mapped issuer for definition publication, lookup and ownership checks', async () => {
    const options = {
      tag: 'default',
      status: { revocation: { enabled: true } },
    };
    request.mockResolvedValueOnce({
      data: {
        credential_definition_state: {
          state: 'finished',
          credential_definition_id: 'definition',
        },
      },
    });
    await service.publishDefinition(context, walletIssuerId, 'schema', options);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          credential_definition: {
            issuerId: ledgerIssuerId,
            schemaId: 'schema',
            tag: 'default',
          },
          options: { support_revocation: true },
          wait_for_revocation_setup: false,
        },
      }),
      false,
    );
    request
      .mockResolvedValueOnce({
        data: { credential_definition_ids: ['definition'] },
      })
      .mockResolvedValueOnce({
        data: {
          credential_definition: {
            issuerId: ledgerIssuerId,
            schemaId: 'schema',
            tag: 'default',
            value: { revocation: {} },
          },
        },
      });
    await expect(
      service.findDefinition(context, walletIssuerId, 'schema', options),
    ).resolves.toBe('definition');
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        params: {
          issuer_id: ledgerIssuerId,
          schema_id: 'schema',
        },
      }),
      true,
    );
  });

  it.each([
    `did:indy:bcovrin:test:${ledgerIssuerId}`,
    'did:indy:not-a-ledger-identifier',
  ])(
    'rejects unsupported Indy representations without sending requests: %s',
    async (issuerId) => {
      const options = {
        tag: 'default',
        status: { revocation: { enabled: true } },
      };
      for (const action of [
        () => service.publishSchema(context, issuerId, schema),
        () => service.findSchema(context, issuerId, schema),
        () => service.publishDefinition(context, issuerId, 'schema', options),
        () => service.findDefinition(context, issuerId, 'schema', options),
      ]) {
        await expect(action()).rejects.toMatchObject({
          issues: [expect.stringContaining('unnamespaced')],
        });
      }
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('requires wallet-owned definition and matching revocation settings', async () => {
    request
      .mockResolvedValueOnce({
        data: { credential_definition_ids: ['definition'] },
      })
      .mockResolvedValueOnce({
        data: {
          credential_definition: {
            issuerId: 'issuer',
            schemaId: 'schema',
            tag: 'default',
            value: {},
          },
        },
      });
    await expect(
      service.findDefinition(context, 'issuer', 'schema', {
        tag: 'default',
        status: { revocation: { enabled: true } },
      }),
    ).rejects.toMatchObject({
      issues: [expect.stringContaining('does not match')],
    });
  });

  it('ignores other definition tags and rejects multiple matches for the requested tag', async () => {
    request
      .mockResolvedValueOnce({
        data: { credential_definition_ids: ['other-tag'] },
      })
      .mockResolvedValueOnce({
        data: {
          credential_definition: {
            issuerId: 'issuer',
            schemaId: 'schema',
            tag: 'other',
            value: { revocation: {} },
          },
        },
      });
    await expect(
      service.findDefinition(context, 'issuer', 'schema', {
        tag: 'default',
        status: { revocation: { enabled: true } },
      }),
    ).resolves.toBeNull();

    request
      .mockResolvedValueOnce({
        data: { credential_definition_ids: ['definition-a', 'definition-b'] },
      })
      .mockResolvedValueOnce({
        data: {
          credential_definition: {
            issuerId: 'issuer',
            schemaId: 'schema',
            tag: 'default',
            value: { revocation: {} },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          credential_definition: {
            issuerId: 'issuer',
            schemaId: 'schema',
            tag: 'default',
            value: { revocation: {} },
          },
        },
      });
    await expect(
      service.findDefinition(context, 'issuer', 'schema', {
        tag: 'default',
        status: { revocation: { enabled: true } },
      }),
    ).rejects.toMatchObject({
      issues: [expect.stringContaining('Ambiguous credential definition')],
    });
  });

  it('requires finished registry, ledger accumulator, capacity and reachable public tails', async () => {
    request
      .mockResolvedValueOnce({
        data: {
          result: {
            cred_def_id: 'definition',
            state: 'finished',
            revoc_reg_id: 'registry',
            tails_local_path: 'https://tails.example/tails',
            max_cred_num: 1000,
          },
        },
      })
      .mockResolvedValueOnce({
        data: { rev_reg_delta: { value: { accum: 'accumulator' } } },
      })
      .mockResolvedValueOnce({ data: { result: 0 } })
      .mockResolvedValueOnce({ status: 200 });
    await expect(service.verifyRevocation(context, 'definition')).resolves.toBe(
      true,
    );
    expect(request).toHaveBeenLastCalledWith({
      method: 'HEAD',
      url: 'https://tails.example/tails',
      maxRedirects: 0,
    });
  });

  it('does not treat pending infrastructure as ready', async () => {
    request.mockResolvedValueOnce({
      data: { result: { cred_def_id: 'definition', state: 'wait' } },
    });
    await expect(service.verifyRevocation(context, 'definition')).resolves.toBe(
      false,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('returns false when the active registry is not found and propagates other backend errors', async () => {
    request.mockRejectedValueOnce(
      new RegistrationBackendError(404, 'NOT_FOUND', 'No active registry'),
    );
    await expect(service.verifyRevocation(context, 'definition')).resolves.toBe(
      false,
    );

    request.mockRejectedValueOnce(
      new RegistrationBackendError(503, 'UNAVAILABLE', 'Backend unavailable'),
    );
    await expect(
      service.verifyRevocation(context, 'definition'),
    ).rejects.toThrow('Backend unavailable');
  });

  it.each([
    { rev_reg_delta: { value: {} } },
    { rev_reg_delta: { value: { accum: 'accumulator' } } },
  ])(
    'does not report revocation readiness without valid accumulator/capacity %j',
    async (delta) => {
      request
        .mockResolvedValueOnce({
          data: {
            result: {
              cred_def_id: 'definition',
              state: 'finished',
              revoc_reg_id: 'registry',
              tails_local_path: 'https://tails.example/tails',
              max_cred_num: 10,
            },
          },
        })
        .mockResolvedValueOnce({ data: delta })
        .mockResolvedValueOnce({ data: { result: 10 } });

      await expect(
        service.verifyRevocation(context, 'definition'),
      ).resolves.toBe(false);
      expect(request).toHaveBeenCalledTimes(3);
    },
  );

  it('rethrows non-Axios failures from the backend client', async () => {
    const failure = new Error('client failure');
    request.mockRejectedValueOnce(failure);

    await expect(service.resolveIssuer(context)).rejects.toBe(failure);
  });
});
