import { LogAccessTokenService } from './log-access-token.service';
import { LogAccessService } from './log-access.service';

const TENANT_ID = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e7b11';

describe('LogAccessService', () => {
  let authorize: jest.Mock;
  let resolve: jest.Mock;
  let service: LogAccessService;

  beforeEach(() => {
    authorize = jest.fn().mockResolvedValue({ tenantId: TENANT_ID });
    resolve = jest.fn().mockResolvedValue([]);
    service = new LogAccessService(
      { authorize } as unknown as LogAccessTokenService,
      { resolveAgentPartitions: resolve },
    );
  });

  it('scopes to the tenant partition only when no agents resolve', async () => {
    await expect(service.resolveScope('Bearer t')).resolves.toBe(
      `t-${TENANT_ID}`,
    );
  });

  it('adds de-duplicated agent partitions after the tenant key', async () => {
    resolve.mockResolvedValue(['a-one', 'a-two', 'a-one']);
    await expect(service.resolveScope('Bearer t')).resolves.toBe(
      `t-${TENANT_ID}|a-one|a-two`,
    );
  });

  it('propagates token denials', async () => {
    authorize.mockRejectedValue(new Error('denied'));
    await expect(service.resolveScope('Bearer t')).rejects.toThrow('denied');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('denies 403 when resolution fails', async () => {
    resolve.mockRejectedValue(new Error('db down'));
    await expect(service.resolveScope('Bearer t')).rejects.toMatchObject({
      status: 403,
      reason: 'resolution_failed',
    });
  });

  it('denies the whole request on an unsafe partition key', async () => {
    resolve.mockResolvedValue(['a-ok', 'bad|key']);
    await expect(service.resolveScope('Bearer t')).rejects.toMatchObject({
      status: 403,
      reason: 'resolution_failed',
    });
  });

  it('denies rather than truncates beyond the partition bound', async () => {
    resolve.mockResolvedValue(Array.from({ length: 10 }, (_v, i) => `a-${i}`));
    await expect(service.resolveScope('Bearer t')).rejects.toMatchObject({
      status: 403,
      reason: 'partition_bound_exceeded',
    });
  });
});
