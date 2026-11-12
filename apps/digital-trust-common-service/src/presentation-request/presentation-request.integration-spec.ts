import { randomUUID } from 'crypto';

import { type AuthContext } from '@app/auth';
import {
  PresentationExchangeState,
  type PresentationRequest,
} from '@app/credential-ports';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { configureApp } from '../app.config';
import { AppModule } from '../app.module';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  Connection,
  ConnectionProtocol,
  ConnectionState,
  ConnectorType,
} from '../connection/connection.entity';
import { buildTractionPresentationRequest } from '../connector/connectors/traction/traction-presentation';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { OperationResponseDto } from '../operation/dto/operation-response.dto';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';
import { ProtocolStateChangeService } from '../protocol-state-change/protocol-state-change.service';
import { Tenant } from '../tenant/tenant.entity';
import { VerificationPredicateCondition } from '../verification-profile/dto/verification-predicate.dto';
import { VerificationProfile } from '../verification-profile/verification-profile.entity';
import { VerificationProfileService } from '../verification-profile/verification-profile.service';

import { PresentationRequestService } from './presentation-request.service';

describe('Presentation definition execution (integration)', () => {
  let app: INestApplication;
  let definitions: VerificationProfileService;
  let requests: PresentationRequestService;
  let tenants: Repository<Tenant>;
  let profiles: Repository<VerificationProfile>;
  let connections: Repository<Connection>;
  let operations: Repository<Operation>;
  let operationService: OperationService;
  let protocol: ProtocolStateChangeService;
  const connectorId = randomUUID();
  const getPresentation = jest.fn();
  const wireRequests: ReturnType<typeof buildTractionPresentationRequest>[] =
    [];
  const boss = {
    start: jest.fn(),
    stop: jest.fn(),
    send: jest.fn(),
    createQueue: jest.fn(),
    schedule: jest.fn(),
    work: jest.fn(),
  };
  const submit = jest.fn((_context: unknown, req: PresentationRequest) => {
    wireRequests.push(buildTractionPresentationRequest(req));
    const externalId = randomUUID();
    return Promise.resolve({
      id: externalId,
      externalId,
      state: PresentationExchangeState.RequestSent,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PgBossService)
      .useValue({
        boss,
        initializeBoss: jest.fn().mockResolvedValue(boss),
        stop: jest.fn(),
        isRunning: jest.fn().mockReturnValue(true),
      })
      .overrideProvider(DomainAuditService)
      .useValue({ emit: jest.fn() })
      .overrideProvider(AdapterRegistry)
      .useValue({
        register: jest.fn(),
        resolve: jest.fn().mockResolvedValue({
          adapter: { requestPresentation: submit, getPresentation },
          context: {},
          connector: { id: connectorId },
          format: CredentialDefinitionFormat.ANONCREDS,
        }),
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    definitions = module.get(VerificationProfileService);
    requests = module.get(PresentationRequestService);
    tenants = module.get(getRepositoryToken(Tenant));
    profiles = module.get(getRepositoryToken(VerificationProfile));
    connections = module.get(getRepositoryToken(Connection));
    operations = module.get(getRepositoryToken(Operation));
    operationService = module.get(OperationService);
    protocol = module.get(ProtocolStateChangeService);
  }, 30000);

  afterAll(async () => app?.close());

  it('stores immutable execution snapshots, distinct nonces and isolated request reads across definition changes/deletion', async () => {
    const tenant = await tenants.save(
      tenants.create({
        name: 'Presentation split test',
        slug: `presentation-${randomUUID()}`,
      }),
    );
    const other = await tenants.save(
      tenants.create({
        name: 'Other presentation tenant',
        slug: `presentation-${randomUUID()}`,
      }),
    );
    const auth = {
      sub: 'user',
      tokenType: 'user',
      clientId: 'spa',
      tenantId: tenant.id,
      roles: [],
      scope: 'profiles:manage credentials:verify',
      scopes: ['profiles:manage', 'credentials:verify'],
      iss: 'https://issuer.example.test',
      aud: 'https://api.example.test',
      exp: 9999999999,
      iat: 1,
    } satisfies AuthContext;
    try {
      const creation = await definitions.createDefinition(
        tenant.id,
        {
          name: 'identity',
          version: '1.0',
          query: {
            type: 'dif-presentation-exchange',
            presentationDefinition: {
              id: 'identity',
              input_descriptors: [
                {
                  id: 'person',
                  constraints: {
                    fields: [{ path: ['$.credentialSubject.name'] }],
                  },
                },
              ],
            },
            predicates: [
              {
                attribute: 'age',
                condition: VerificationPredicateCondition.GREATER_THAN_OR_EQUAL,
                value: '19',
              },
            ],
          },
          options: { format: CredentialDefinitionFormat.ANONCREDS },
        },
        auth,
      );
      const definition = await profiles.findOneByOrFail({
        id: String(creation.result?.id),
        tenantId: tenant.id,
      });
      expect(definition.presentationFormat).toBe(
        CredentialDefinitionFormat.ANONCREDS,
      );
      expect(creation.result?.query).toMatchObject({
        presentation_definition: definition.presentationDefinition,
      });
      const update = await definitions.updateDefinition(
        tenant.id,
        definition.id,
        { description: 'updated' },
        auth,
      );
      expect(update.result?.description).toBe('updated');
      expect(
        (await operations.findOneByOrFail({ id: creation.id })).result
          ?.description,
      ).not.toBe('updated');
      const publish = await definitions.publishDefinition(
        tenant.id,
        definition.id,
        auth,
      );
      expect(publish.type).toBe('presentation-definition.publish');
      const connection = await connections.save(
        connections.create({
          tenantId: tenant.id,
          externalConnectionId: randomUUID(),
          connectorType: ConnectorType.TRACTION,
          state: ConnectionState.ACTIVE,
          protocol: ConnectionProtocol.DIDCOMM_V1,
        }),
      );
      const dto = {
        presentationDefinitionId: definition.id,
        delivery: { connectionId: connection.id },
      };
      const first = await requests.create(tenant.id, dto, auth);
      const second = await requests.create(tenant.id, dto, auth);
      expect(first.state).toBe(OperationState.PROCESSING);
      const stored = await operations.findOneByOrFail({
        id: first.id,
        tenantId: tenant.id,
      });
      expect(stored.request.body.snapshot).toMatchObject({
        definition: { id: definition.id, version: '1.0' },
        options: { format: 'anoncreds' },
        proof_request: {
          requestedAttributes: [{ name: 'name' }],
          requestedPredicates: [{ name: 'age', pType: '>=', pValue: 19 }],
        },
      });
      expect(wireRequests[0].presentation_request.anoncreds.nonce).not.toBe(
        wireRequests[1].presentation_request.anoncreds.nonce,
      );
      expect(
        wireRequests[0].presentation_request.anoncreds.requested_predicates,
      ).toEqual({
        predicate_0: { name: 'age', p_type: '>=', p_value: 19 },
      });
      submit.mockRejectedValueOnce(new Error('backend unavailable'));
      const failed = await requests.create(tenant.id, dto, auth);
      expect(failed.state).toBe(OperationState.FAILED);
      expect(
        (
          await operations.findOneByOrFail({
            id: failed.id,
            tenantId: tenant.id,
          })
        ).result,
      ).toEqual({ code: 'ADAPTER_ERROR', message: 'backend unavailable' });
      submit.mockRejectedValueOnce(new Error('legacy submission failed'));
      await expect(
        requests.requestPresentation(tenant.id, {
          verificationProfileId: definition.id,
          connectionId: connection.id,
        }),
      ).rejects.toThrow('legacy submission failed');
      await expect(
        definitions.updateDefinition(
          tenant.id,
          definition.id,
          { description: 'changed' },
          auth,
        ),
      ).rejects.toThrow('not in draft');
      await definitions.deprecateDefinition(tenant.id, definition.id, auth);
      await profiles.update(
        { id: definition.id, tenantId: tenant.id },
        { presentationDefinition: {}, predicates: [] },
      );
      await profiles.delete({ id: definition.id, tenantId: tenant.id });
      expect(
        (
          await operations.findOneByOrFail({
            id: first.id,
            tenantId: tenant.id,
          })
        ).request,
      ).toEqual(stored.request);
      getPresentation.mockResolvedValue({
        id: first.externalId,
        connectionId: connection.externalConnectionId,
        state: PresentationExchangeState.Verified,
        verified: true,
        revealedAttributes: [
          { referent: 'attribute_0', name: 'name', value: 'Alice' },
        ],
        predicates: [
          {
            referent: 'predicate_0',
            name: 'age',
            pType: '>=',
            pValue: 19,
            satisfied: true,
          },
        ],
      });
      await protocol.process({
        tenantId: tenant.id,
        connectorId,
        topic: 'present_proof',
        externalId: first.externalId!,
        protocolState: 'done',
        payload: { verified: 'true' },
      });
      const completed = OperationResponseDto.fromEntity(
        await requests.get(tenant.id, first.id, auth),
      );
      expect(completed.state).toBe('completed');
      expect(completed.result).toEqual({
        verified: true,
        revealed_attributes: [
          { referent: 'attribute_0', name: 'name', value: 'Alice' },
        ],
        predicates: [
          {
            referent: 'predicate_0',
            name: 'age',
            operator: '>=',
            threshold: 19,
            satisfied: true,
          },
        ],
      });
      expect(completed.steps.map((step) => step.state)).toEqual([
        'completed',
        'completed',
        'completed',
      ]);

      const count = await operations.countBy({ tenantId: tenant.id });
      const fail = jest
        .spyOn(operationService, 'transitionState')
        .mockRejectedValueOnce(new Error('operation persistence failed'));
      try {
        await expect(
          definitions.createDefinition(
            tenant.id,
            {
              name: 'rollback',
              version: '1.0',
              query: {
                type: 'dif-presentation-exchange',
                presentationDefinition: definition.presentationDefinition,
              },
              options: { format: CredentialDefinitionFormat.ANONCREDS },
            },
            auth,
          ),
        ).rejects.toThrow('operation persistence failed');
      } finally {
        fail.mockRestore();
      }
      expect(
        await profiles.findOneBy({ tenantId: tenant.id, name: 'rollback' }),
      ).toBeNull();
      expect(await operations.countBy({ tenantId: tenant.id })).toBe(count);
      expect((await requests.get(tenant.id, first.id, auth)).id).toBe(first.id);
      expect((await requests.get(tenant.id, second.id, auth)).id).toBe(
        second.id,
      );
      await expect(
        requests.get(other.id, first.id, { ...auth, tenantId: other.id }),
      ).rejects.toThrow('Operation not found');
      await expect(
        definitions.findById(other.id, definition.id, {
          ...auth,
          tenantId: other.id,
        }),
      ).rejects.toThrow();
    } finally {
      for (const id of [tenant.id, other.id]) {
        await operations.delete({ tenantId: id });
        await connections.delete({ tenantId: id });
        await profiles.delete({ tenantId: id });
        await tenants.delete({ id });
      }
    }
  });
});
