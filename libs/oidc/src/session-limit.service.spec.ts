import { Test, TestingModule } from '@nestjs/testing';

import {
  AccountSession,
  OidcAccountSessionRepository,
} from './oidc-account-session.repository';
import { OidcConfigService } from './oidc-config.service';
import { SessionLimitService } from './session-limit.service';

describe('SessionLimitService', () => {
  let service: SessionLimitService;
  let findActiveSessions: jest.Mock;
  let deleteSessions: jest.Mock;
  let maxConcurrentSessions: number;

  function session(oidcId: string, minutesOld: number): AccountSession {
    return {
      oidcId,
      createdAt: new Date(Date.now() - minutesOld * 60_000),
      grantIds: [`grant-for-${oidcId}`],
    };
  }

  beforeEach(async () => {
    maxConcurrentSessions = 5;
    findActiveSessions = jest.fn().mockResolvedValue([]);
    deleteSessions = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLimitService,
        {
          provide: OidcAccountSessionRepository,
          useValue: { findActiveSessions, deleteSessions },
        },
        {
          provide: OidcConfigService,
          useValue: { getConfig: () => ({ maxConcurrentSessions }) },
        },
      ],
    }).compile();

    service = module.get(SessionLimitService);
  });

  it('does nothing when the account is under the limit', async () => {
    findActiveSessions.mockResolvedValue([session('s1', 10), session('s2', 5)]);

    const result = await service.enforce('user-1', 's2');

    expect(deleteSessions).not.toHaveBeenCalled();
    expect(result).toEqual({
      priorSessionCount: 2,
      evictedSessionCount: 0,
      limit: 5,
    });
  });

  it('does nothing when the account is exactly at the limit', async () => {
    findActiveSessions.mockResolvedValue([
      session('s1', 50),
      session('s2', 40),
      session('s3', 30),
      session('s4', 20),
      session('s5', 10),
    ]);

    const result = await service.enforce('user-1', 's5');

    expect(deleteSessions).not.toHaveBeenCalled();
    expect(result.evictedSessionCount).toBe(0);
  });

  it('evicts the oldest session when the new login exceeds the limit', async () => {
    findActiveSessions.mockResolvedValue([
      session('oldest', 60),
      session('s2', 50),
      session('s3', 40),
      session('s4', 30),
      session('s5', 20),
      session('new', 0),
    ]);

    const result = await service.enforce('user-1', 'new');

    expect(deleteSessions).toHaveBeenCalledTimes(1);
    expect(
      deleteSessions.mock.calls[0][0].map((s: AccountSession) => s.oidcId),
    ).toEqual(['oldest']);
    expect(result.evictedSessionCount).toBe(1);
  });

  it('never evicts the session that just logged in', async () => {
    // The new session is the oldest by timestamp (e.g. clock skew across
    // pods), so ordering alone would pick it first.
    findActiveSessions.mockResolvedValue([
      session('new', 99),
      session('s1', 50),
      session('s2', 40),
      session('s3', 30),
      session('s4', 20),
      session('s5', 10),
    ]);

    await service.enforce('user-1', 'new');

    const evicted = deleteSessions.mock.calls[0][0].map(
      (s: AccountSession) => s.oidcId,
    );
    expect(evicted).not.toContain('new');
    expect(evicted).toEqual(['s1']);
  });

  it('evicts several sessions at once when the limit was lowered', async () => {
    maxConcurrentSessions = 2;
    findActiveSessions.mockResolvedValue([
      session('s1', 60),
      session('s2', 50),
      session('s3', 40),
      session('s4', 30),
      session('new', 0),
    ]);

    const result = await service.enforce('user-1', 'new');

    expect(
      deleteSessions.mock.calls[0][0].map((s: AccountSession) => s.oidcId),
    ).toEqual(['s1', 's2', 's3']);
    expect(result.evictedSessionCount).toBe(3);
  });

  it('evicts grants and tokens along with the session', async () => {
    maxConcurrentSessions = 1;
    findActiveSessions.mockResolvedValue([
      session('old', 60),
      session('new', 0),
    ]);

    await service.enforce('user-1', 'new');

    expect(deleteSessions.mock.calls[0][0][0].grantIds).toEqual([
      'grant-for-old',
    ]);
  });

  it('is disabled when the limit is zero', async () => {
    maxConcurrentSessions = 0;
    findActiveSessions.mockResolvedValue([
      session('s1', 60),
      session('s2', 50),
    ]);

    const result = await service.enforce('user-1', 's2');

    expect(findActiveSessions).not.toHaveBeenCalled();
    expect(deleteSessions).not.toHaveBeenCalled();
    expect(result.evictedSessionCount).toBe(0);
  });

  it('enforces the limit even when no new session id is supplied', async () => {
    maxConcurrentSessions = 1;
    findActiveSessions.mockResolvedValue([
      session('s1', 60),
      session('s2', 10),
    ]);

    await service.enforce('user-1');

    expect(
      deleteSessions.mock.calls[0][0].map((s: AccountSession) => s.oidcId),
    ).toEqual(['s1']);
  });
});
