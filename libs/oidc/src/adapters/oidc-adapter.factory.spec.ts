import type { Repository } from 'typeorm';

import { OidcModel } from '../entities/oidc-model.entity';
import type { OidcClientLookupPort } from '../ports/oidc-client-lookup.port';

import { OidcAdapterFactory } from './oidc-adapter.factory';
import { OidcClientAdapter } from './oidc-client.adapter';
import { OidcModelAdapter } from './oidc-model.adapter';

describe('OidcAdapterFactory', () => {
  let repository: jest.Mocked<Repository<OidcModel>>;
  let clientLookup: jest.Mocked<OidcClientLookupPort>;
  let factory: OidcAdapterFactory;

  beforeEach(() => {
    repository = {} as jest.Mocked<Repository<OidcModel>>;
    clientLookup = { findActiveClient: jest.fn() };
    factory = new OidcAdapterFactory(repository, clientLookup);
  });

  it('returns an OidcClientAdapter for the "Client" model', () => {
    expect(factory.forModel('Client')).toBeInstanceOf(OidcClientAdapter);
  });

  it('returns an OidcModelAdapter for any other model name', () => {
    expect(factory.forModel('AccessToken')).toBeInstanceOf(OidcModelAdapter);
    expect(factory.forModel('Session')).toBeInstanceOf(OidcModelAdapter);
  });

  it('preserves "this" binding when destructured, matching oidc-provider usage', () => {
    const { forModel } = factory;

    expect(forModel('Client')).toBeInstanceOf(OidcClientAdapter);
  });
});
