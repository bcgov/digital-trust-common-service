import { Logger } from '@nestjs/common';
import type { Request } from 'express';

import { LogAccessDeniedError } from './log-access-denied.error';
import { LogAccessController } from './log-access.controller';
import { LogAccessService } from './log-access.service';

describe('LogAccessController', () => {
  let resolveScope: jest.Mock;
  let controller: LogAccessController;
  let res: {
    status: jest.Mock;
    setHeader: jest.Mock;
    end: jest.Mock;
    json: jest.Mock;
  };

  beforeEach(() => {
    resolveScope = jest.fn();
    controller = new LogAccessController({
      resolveScope,
    } as unknown as LogAccessService);
    res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      end: jest.fn(),
      json: jest.fn(),
    };
  });

  const check = (
    inbound?: string,
    req: Partial<Request> = { originalUrl: '/internal/log-access/check' },
  ): Promise<void> =>
    controller.check(
      'Bearer t',
      inbound,
      { headers: {}, ...req } as Request,
      res as never,
    );

  it('allows with an empty body and the computed scope header', async () => {
    resolveScope.mockResolvedValue('t-abc');
    await check();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('X-Scope-OrgID', 't-abc');
    expect(res.json).not.toHaveBeenCalled();
  });

  it('ignores a caller-supplied scope header', async () => {
    resolveScope.mockResolvedValue('t-abc');
    await check('t-victim');
    expect(res.setHeader).toHaveBeenCalledWith('X-Scope-OrgID', 't-abc');
  });

  it('answers every 403 reason with the same body', async () => {
    resolveScope.mockRejectedValueOnce(
      new LogAccessDeniedError(403, 'resolution_failed'),
    );
    await check();
    resolveScope.mockRejectedValueOnce(
      new LogAccessDeniedError(403, 'partition_bound_exceeded'),
    );
    await check();

    expect(res.status).toHaveBeenNthCalledWith(1, 403);
    expect(res.status).toHaveBeenNthCalledWith(2, 403);
    expect(res.json.mock.calls[0]).toEqual(res.json.mock.calls[1]);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
  });

  it('answers a 401 denial with the fixed unauthorized body', async () => {
    resolveScope.mockRejectedValue(
      new LogAccessDeniedError(401, 'invalid_token'),
    );
    await check();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' });
  });

  it('answers a rate-limited denial with 429 too_many_requests', async () => {
    resolveScope.mockRejectedValue(
      new LogAccessDeniedError(429, 'rate_limited'),
    );
    await check();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'too_many_requests' });
  });

  describe('tenant-selecting parameters', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      resolveScope.mockResolvedValue('t-abc');
    });

    afterEach(() => warn.mockRestore());

    it.each([
      ['?tenant=t-victim', 'tenant'],
      ['?Tenant_Id=t-victim&x=1', 'tenant_id'],
      ['?org_id=t-victim', 'org_id'],
      ['?org=t-victim', 'org'],
      ['?scope=t-victim', 'scope'],
    ])('ignores and records %s', async (query, name) => {
      await check(undefined, {
        originalUrl: `/internal/log-access/check/loki/api/v1/query${query}`,
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.setHeader).toHaveBeenCalledWith('X-Scope-OrgID', 't-abc');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('t-victim'),
      );
    });

    it('inspects the forwarded original path', async () => {
      await check(undefined, {
        originalUrl: '/internal/log-access/check',
        headers: { 'x-envoy-original-path': '/loki/api/v1/query?orgId=x' },
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('orgid'));
    });

    it('does not warn for ordinary parameters', async () => {
      await check(undefined, {
        originalUrl: '/internal/log-access/check?query=%7Bapp%3D%22x%22%7D',
      });

      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('rethrows an unexpected error so Nest surfaces it as 5xx', async () => {
    resolveScope.mockRejectedValue(new Error('boom'));
    await expect(check()).rejects.toThrow('boom');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
