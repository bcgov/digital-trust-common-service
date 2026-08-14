import { ScopeAuthorizationService } from './scope-authorization.service';

describe('ScopeAuthorizationService', () => {
  let service: ScopeAuthorizationService;

  beforeEach(() => {
    service = new ScopeAuthorizationService();
  });

  describe('isPlatformAdmin', () => {
    it('returns true when platform-admin role is present', () => {
      expect(service.isPlatformAdmin(['platform-admin'])).toBe(true);
    });

    it('returns false for tenant roles only', () => {
      expect(service.isPlatformAdmin(['admin', 'owner'])).toBe(false);
    });
  });

  describe('hasRequiredRoles', () => {
    it('returns true when all required roles are present', () => {
      expect(
        service.hasRequiredRoles(
          ['platform-admin', 'admin'],
          ['platform-admin'],
        ),
      ).toBe(true);
    });

    it('returns false when a required role is missing', () => {
      expect(service.hasRequiredRoles(['admin'], ['platform-admin'])).toBe(
        false,
      );
    });

    it('returns true when no roles are required', () => {
      expect(service.hasRequiredRoles(['admin'], [])).toBe(true);
    });
  });

  describe('expandEffectiveScopes', () => {
    it('expands tenants:admin to all Level 2 and Level 3 scopes', () => {
      const effective = service.expandEffectiveScopes(['tenants:admin']);

      expect(effective.has('tenants:admin')).toBe(true);
      expect(effective.has('credentials:offer')).toBe(true);
      expect(effective.has('audit:read')).toBe(true);
      expect(effective.size).toBeGreaterThan(1);
    });

    it('does not expand scopes without tenants:admin', () => {
      const effective = service.expandEffectiveScopes(['credentials:offer']);

      expect(effective.has('credentials:offer')).toBe(true);
      expect(effective.has('audit:read')).toBe(false);
    });
  });

  describe('hasRequiredScopes', () => {
    it('returns true when token has an explicitly required scope', () => {
      expect(
        service.hasRequiredScopes(['credentials:offer'], ['credentials:offer']),
      ).toBe(true);
    });

    it('grants Level 2 scopes when token has tenants:admin', () => {
      expect(
        service.hasRequiredScopes(['tenants:admin'], ['profiles:manage']),
      ).toBe(true);
    });

    it('grants Level 3 scopes when token has tenants:admin', () => {
      expect(service.hasRequiredScopes(['tenants:admin'], ['audit:read'])).toBe(
        true,
      );
    });

    it('returns false when required scope is missing', () => {
      expect(
        service.hasRequiredScopes(['credentials:offer'], ['audit:read']),
      ).toBe(false);
    });

    it('requires all listed scopes (AND logic)', () => {
      expect(
        service.hasRequiredScopes(
          ['credentials:offer'],
          ['credentials:offer', 'audit:read'],
        ),
      ).toBe(false);
    });

    it('returns true when no scopes are required', () => {
      expect(service.hasRequiredScopes(['credentials:offer'], [])).toBe(true);
    });
  });
});
