import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Adapter } from 'oidc-provider';
import type { Repository } from 'typeorm';

import { OidcModel } from '../entities/oidc-model.entity';
import { OIDC_CLIENT_LOOKUP_PORT } from '../ports/oidc-client-lookup.port';
import type { OidcClientLookupPort } from '../ports/oidc-client-lookup.port';

import { OidcClientAdapter } from './oidc-client.adapter';
import { OidcModelAdapter } from './oidc-model.adapter';

const CLIENT_MODEL_NAME = 'Client';

@Injectable()
export class OidcAdapterFactory {
  public constructor(
    @InjectRepository(OidcModel)
    private readonly oidcModelRepository: Repository<OidcModel>,
    @Inject(OIDC_CLIENT_LOOKUP_PORT)
    private readonly clientLookup: OidcClientLookupPort,
  ) {}

  /**
   * Matches oidc-provider's `AdapterFactory` signature: `(name: string) => Adapter`.
   * Declared as an arrow class field so `this` stays bound when this method
   * is passed by reference into `Configuration.adapter`.
   */
  public forModel = (name: string): Adapter => {
    if (name === CLIENT_MODEL_NAME) {
      return new OidcClientAdapter(this.clientLookup);
    }

    return new OidcModelAdapter(name, this.oidcModelRepository);
  };
}
