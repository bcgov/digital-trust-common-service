import { NotImplementedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';

import { TractionAdapter } from './traction.adapter';

describe('TractionAdapter', () => {
  let adapter: TractionAdapter;
  let mockRegister: jest.Mock;

  beforeEach(async () => {
    mockRegister = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TractionAdapter,
        {
          provide: AdapterRegistry,
          useValue: { register: mockRegister },
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
    await expect(adapter.createInvitation(context, {})).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(
      adapter.acceptInvitation(context, 'https://example.com/invitation'),
    ).rejects.toBeInstanceOf(NotImplementedException);
    await expect(adapter.list(context, {})).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(adapter.getById(context, 'id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(adapter.revoke(context, 'id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(adapter.batchRevoke(context, ['id'])).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});
