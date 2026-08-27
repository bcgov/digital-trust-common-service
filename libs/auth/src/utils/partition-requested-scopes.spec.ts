import { partitionRequestedScopes } from './partition-requested-scopes';

describe('partitionRequestedScopes', () => {
  it('grants the intersection of allowed and actor scopes', () => {
    expect(
      partitionRequestedScopes({
        requestedScopes: ['openid', 'credentials:offer', 'clients:manage'],
        allowedScopes: ['openid', 'credentials:offer', 'clients:manage'],
        actorScopes: ['openid', 'credentials:offer'],
      }),
    ).toEqual({
      grantedScopes: ['openid', 'credentials:offer'],
      deniedScopes: ['clients:manage'],
    });
  });

  it('lets platform-admin bypass the actor subset while still requiring allowedScopes', () => {
    expect(
      partitionRequestedScopes({
        requestedScopes: ['credentials:offer', 'not:a-scope'],
        allowedScopes: ['credentials:offer'],
        actorScopes: [],
        isPlatformAdmin: true,
      }),
    ).toEqual({
      grantedScopes: ['credentials:offer'],
      deniedScopes: ['not:a-scope'],
    });
  });

  it('treats protocol scopes as grantable when they are in both allowed and actor sets', () => {
    const protocolAndRole = ['openid', 'profile', 'credentials:verify'];

    expect(
      partitionRequestedScopes({
        requestedScopes: ['openid', 'profile', 'credentials:verify'],
        allowedScopes: protocolAndRole,
        actorScopes: protocolAndRole,
      }),
    ).toEqual({
      grantedScopes: ['openid', 'profile', 'credentials:verify'],
      deniedScopes: [],
    });
  });
});
