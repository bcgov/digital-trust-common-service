import {
  ALL_TENANT_SCOPES,
  OIDC_SCOPE_ALLOWLIST,
  ROLE_HIERARCHY,
  SCOPE_CATALOG,
  TENANT_SUPERUSER_SCOPE,
  isKnownScope,
} from './scopes.constants';

describe('scope constants', () => {
  describe('SCOPE_CATALOG', () => {
    it('publishes every tenant scope plus the superuser scope', () => {
      expect(SCOPE_CATALOG.map((entry) => entry.name).sort()).toEqual(
        [TENANT_SUPERUSER_SCOPE, ...ALL_TENANT_SCOPES].sort(),
      );
    });

    it('describes every scope exactly once', () => {
      const names = SCOPE_CATALOG.map((entry) => entry.name);

      expect(new Set(names).size).toBe(names.length);
      expect(
        SCOPE_CATALOG.every((entry) => entry.description.trim().length > 0),
      ).toBe(true);
    });

    /**
     * The catalog is hand-enumerated and the allowlist is derived, so the two
     * can drift. Drift is not cosmetic: `isKnownScope` validates overrides
     * against the catalog, so a scope present in the catalog but missing from
     * the allowlist is storable as an override and then rejected at Grant
     * creation — which breaks login for every user of that role, not just the
     * request that stored it.
     */
    it('matches the oidc-provider allowlist', () => {
      const allowlisted = OIDC_SCOPE_ALLOWLIST.filter(
        (scope) => scope !== 'openid',
      );

      expect(SCOPE_CATALOG.map((entry) => entry.name).sort()).toEqual(
        [...allowlisted].sort(),
      );
    });

    it('assigns the superuser scope a higher level than the scopes it grants', () => {
      const superuser = SCOPE_CATALOG.find(
        (entry) => entry.name === TENANT_SUPERUSER_SCOPE,
      );
      const others = SCOPE_CATALOG.filter(
        (entry) => entry.name !== TENANT_SUPERUSER_SCOPE,
      );

      expect(superuser?.level).toBe(1);
      expect(others.every((entry) => entry.level > 1)).toBe(true);
    });
  });

  describe('isKnownScope', () => {
    it('accepts every catalogued scope', () => {
      expect(SCOPE_CATALOG.every((entry) => isKnownScope(entry.name))).toBe(
        true,
      );
    });

    it('rejects anything else', () => {
      expect(isKnownScope('openid')).toBe(false);
      expect(isKnownScope('credentials:offer ')).toBe(false);
      expect(isKnownScope('')).toBe(false);
    });
  });

  describe('ROLE_HIERARCHY', () => {
    it('runs from most to least privileged without duplicates', () => {
      expect(ROLE_HIERARCHY).toEqual(['owner', 'admin', 'member', 'readonly']);
      expect(new Set(ROLE_HIERARCHY).size).toBe(ROLE_HIERARCHY.length);
    });
  });
});
