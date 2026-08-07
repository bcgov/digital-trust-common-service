import { JwtGuard, ScopeGuard, TenantGuard } from './index';

describe('guards index', () => {
  it('re-exports guard classes', () => {
    expect(JwtGuard).toBeDefined();
    expect(ScopeGuard).toBeDefined();
    expect(TenantGuard).toBeDefined();
  });
});
