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

  const check = (inbound?: string): Promise<void> =>
    controller.check('Bearer t', inbound, res as never);

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

  it('fails closed with 403 on an unexpected error', async () => {
    resolveScope.mockRejectedValue(new Error('boom'));
    await check();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
  });
});
