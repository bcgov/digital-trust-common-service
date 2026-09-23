import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  it('returns undefined outside of a run() call', () => {
    expect(service.get()).toBeUndefined();
    expect(service.getRequestId()).toBeUndefined();
    expect(service.getTenantId()).toBeUndefined();
  });

  it('exposes the store for the duration of the callback', () => {
    service.run({ requestId: 'req-1', source: 'api' }, () => {
      expect(service.get()).toEqual({ requestId: 'req-1', source: 'api' });
      expect(service.getRequestId()).toBe('req-1');
      expect(service.getTenantId()).toBeUndefined();
    });

    expect(service.get()).toBeUndefined();
  });

  it('sets the tenant id on the active store', () => {
    service.run({ requestId: 'req-1', source: 'api' }, () => {
      service.setTenantId('tenant-1');
      expect(service.getTenantId()).toBe('tenant-1');
    });
  });

  it('is a no-op when setting the tenant id outside a run() call', () => {
    expect(() => service.setTenantId('tenant-1')).not.toThrow();
    expect(service.getTenantId()).toBeUndefined();
  });

  it('isolates concurrent async contexts', async () => {
    const results: string[] = [];

    await Promise.all([
      service.run({ requestId: 'req-a', source: 'api' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(`a:${service.getRequestId()}`);
      }),
      service.run({ requestId: 'req-b', source: 'api' }, async () => {
        await Promise.resolve();
        results.push(`b:${service.getRequestId()}`);
      }),
    ]);

    expect(results).toContain('a:req-a');
    expect(results).toContain('b:req-b');
  });
});
