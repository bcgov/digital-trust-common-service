import { Test, TestingModule } from '@nestjs/testing';

import {
  AccountSession,
  OidcAccountSessionRepository,
} from './oidc-account-session.repository';
import { OidcConfigService } from './oidc-config.service';
import { SessionLimitService } from './session-limit.service';

describe('SessionLimitService', () => {
  let service: SessionLimitService;
  let countActiveSessions: jest.Mock;
  let claimSurplusSessions: jest.Mock;
  let deleteSessions: jest.Mock;
  let maxConcurrentSessions: number;

  function session(oidcId: string): AccountSession {
    return {
      oidcId,
      createdAt: new Date(),
      grantIds: [`grant-for-${oidcId}`],
    };
  }

  beforeEach(async () => {
    maxConcurrentSessions = 5;
    countActiveSessions = jest.fn().mockResolvedValue(0);
    claimSurplusSessions = jest.fn().mockResolvedValue([]);
    deleteSessions = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLimitService,
        {
          provide: OidcAccountSessionRepository,
          useValue: {
            countActiveSessions,
            claimSurplusSessions,
            deleteSessions,
          },
        },
        {
          provide: OidcConfigService,
          useValue: { getConfig: () => ({ maxConcurrentSessions }) },
        },
      ],
    }).compile();

    service = module.get(SessionLimitService);
  });

  it('reports no eviction when the account is within the limit', async () => {
    countActiveSessions.mockResolvedValue(2);

    const result = await service.enforce('user-1', 's2');

    expect(deleteSessions).not.toHaveBeenCalled();
    expect(result).toEqual({
      priorSessionCount: 2,
      evictedSessionCount: 0,
      limit: 5,
    });
  });

  it('passes the limit and the new session id through to the claim', async () => {
    await service.enforce('user-1', 'new');

    expect(claimSurplusSessions).toHaveBeenCalledWith('user-1', 5, 'new');
  });

  it('clears the grants and tokens of every claimed session', async () => {
    countActiveSessions.mockResolvedValue(7);
    claimSurplusSessions.mockResolvedValue([session('old'), session('older')]);

    const result = await service.enforce('user-1', 'new');

    expect(deleteSessions).toHaveBeenCalledTimes(1);
    expect(
      deleteSessions.mock.calls[0][0].map((s: AccountSession) => s.grantIds),
    ).toEqual([['grant-for-old'], ['grant-for-older']]);
    expect(result.evictedSessionCount).toBe(2);
  });

  it('is disabled when the limit is zero', async () => {
    maxConcurrentSessions = 0;

    const result = await service.enforce('user-1', 's2');

    expect(countActiveSessions).not.toHaveBeenCalled();
    expect(claimSurplusSessions).not.toHaveBeenCalled();
    expect(deleteSessions).not.toHaveBeenCalled();
    expect(result.evictedSessionCount).toBe(0);
  });

  it('enforces the limit even when no new session id is supplied', async () => {
    maxConcurrentSessions = 1;

    await service.enforce('user-1');

    expect(claimSurplusSessions).toHaveBeenCalledWith('user-1', 1, undefined);
  });
});
