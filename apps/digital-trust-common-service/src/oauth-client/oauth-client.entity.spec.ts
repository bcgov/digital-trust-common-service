import { getMetadataArgsStorage } from 'typeorm';

import { Tenant } from '../tenant/tenant.entity';

import { OAuthClient } from './oauth-client.entity';

describe('OAuthClient entity', () => {
  it('declares ManyToOne relation targeting Tenant', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (entry) =>
        entry.target === OAuthClient && entry.propertyName === 'tenant',
    );

    expect(relation).toBeDefined();
    expect(typeof relation?.type).toBe('function');
    expect((relation?.type as () => typeof Tenant)()).toBe(Tenant);
  });
});
