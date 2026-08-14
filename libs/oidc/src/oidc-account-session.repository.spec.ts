import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OidcModel } from './entities/oidc-model.entity';
import {
  ACCOUNT_BOUND_MODELS,
  OidcAccountSessionRepository,
} from './oidc-account-session.repository';

describe('OidcAccountSessionRepository', () => {
  let repository: OidcAccountSessionRepository;
  let mockQuery: jest.Mock;

  beforeEach(async () => {
    mockQuery = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcAccountSessionRepository,
        {
          provide: getRepositoryToken(OidcModel),
          useValue: { manager: { query: mockQuery } },
        },
      ],
    }).compile();

    repository = module.get(OidcAccountSessionRepository);
  });

  describe('countActiveSessions', () => {
    it('counts only unexpired Session rows for the account', async () => {
      mockQuery.mockResolvedValue([{ count: '3' }]);

      await expect(repository.countActiveSessions('user-1')).resolves.toBe(3);

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('model_name = $1');
      expect(sql).toContain('expires_at > now()');
      expect(params).toEqual(['Session', 'user-1']);
    });

    it('returns zero when the account has no sessions', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(repository.countActiveSessions('user-1')).resolves.toBe(0);
    });
  });

  describe('findActiveSessions', () => {
    it('returns sessions oldest first with their grant ids', async () => {
      mockQuery.mockResolvedValue([
        {
          oidc_id: 'session-1',
          created_at: new Date('2026-01-01T00:00:00Z'),
          payload: {
            authorizations: {
              'client-a': { grantId: 'grant-a' },
              'client-b': { grantId: 'grant-b' },
            },
          },
        },
      ]);

      const sessions = await repository.findActiveSessions('user-1');

      expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY created_at ASC');
      expect(sessions).toEqual([
        {
          oidcId: 'session-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          grantIds: ['grant-a', 'grant-b'],
        },
      ]);
    });

    it('tolerates sessions with no authorizations yet', async () => {
      mockQuery.mockResolvedValue([
        { oidc_id: 'session-1', created_at: new Date(), payload: {} },
      ]);

      const [session] = await repository.findActiveSessions('user-1');

      expect(session.grantIds).toEqual([]);
    });

    it('ignores malformed authorization entries', async () => {
      mockQuery.mockResolvedValue([
        {
          oidc_id: 'session-1',
          created_at: new Date(),
          payload: {
            authorizations: {
              'client-a': { grantId: 'grant-a' },
              'client-b': null,
              'client-c': {},
              'client-d': { grantId: 42 },
            },
          },
        },
      ]);

      const [session] = await repository.findActiveSessions('user-1');

      expect(session.grantIds).toEqual(['grant-a']);
    });
  });

  describe('claimSurplusSessions', () => {
    /**
     * TypeORM's Postgres driver returns `[rows, rowCount]` for DELETE and
     * UPDATE, including when a RETURNING clause is present, so the mock has
     * to use that shape rather than a bare row array.
     */
    it('unwraps the driver tuple and keeps only the returned rows', async () => {
      mockQuery.mockResolvedValue([
        [
          {
            oidc_id: 'session-1',
            created_at: new Date('2026-01-01T00:00:00Z'),
            payload: { authorizations: { 'client-a': { grantId: 'grant-a' } } },
          },
        ],
        1,
      ]);

      const claimed = await repository.claimSurplusSessions('user-1', 5, 'new');

      expect(claimed).toEqual([
        {
          oidcId: 'session-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          grantIds: ['grant-a'],
        },
      ]);
    });

    it('returns nothing when the delete affected no rows', async () => {
      mockQuery.mockResolvedValue([[], 0]);

      await expect(
        repository.claimSurplusSessions('user-1', 5, 'new'),
      ).resolves.toEqual([]);
    });

    it('reserves a slot for the new session and never evicts it', async () => {
      await repository.claimSurplusSessions('user-1', 5, 'new');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(params).toEqual(['Session', 'user-1', 4, 'new']);
    });

    it('offsets by the full limit when there is no new session', async () => {
      await repository.claimSurplusSessions('user-1', 5);

      const [, params] = mockQuery.mock.calls[0];
      expect(params).toEqual(['Session', 'user-1', 5, null]);
    });

    it('never offsets by a negative amount', async () => {
      await repository.claimSurplusSessions('user-1', 0, 'new');

      const [, params] = mockQuery.mock.calls[0];
      expect(params[2]).toBe(0);
    });

    /**
     * `oidc_model` is keyed on `(model_name, oidc_id)`, so an id can be
     * reused across model kinds. Without the outer filter the delete would
     * take unrelated rows that happen to share a session id.
     */
    it('constrains the outer delete to Session rows', async () => {
      await repository.claimSurplusSessions('user-1', 5, 'new');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/DELETE FROM oidc_model\s+WHERE model_name = \$1/);
    });
  });

  describe('deleteSessions', () => {
    it('does not issue a query when there is nothing to delete', async () => {
      await expect(repository.deleteSessions([])).resolves.toEqual([]);

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('deletes the sessions and cascades to their grants and tokens', async () => {
      mockQuery.mockResolvedValue([
        { model_name: 'Session', count: '1' },
        { model_name: 'RefreshToken', count: '2' },
      ]);

      const result = await repository.deleteSessions([
        { oidcId: 'session-1', createdAt: new Date(), grantIds: ['grant-a'] },
      ]);

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('DELETE FROM oidc_model');
      expect(sql).toContain('grant_id = ANY($3::varchar[])');
      expect(params[1]).toEqual(['session-1']);
      expect(params[2]).toEqual(['grant-a']);
      expect(result).toEqual([
        { modelName: 'Session', count: 1 },
        { modelName: 'RefreshToken', count: 2 },
      ]);
    });

    it('deletes the Grant rows themselves, not just rows referencing them', async () => {
      await repository.deleteSessions([
        { oidcId: 'session-1', createdAt: new Date(), grantIds: ['grant-a'] },
      ]);

      expect(mockQuery.mock.calls[0][0]).toContain(
        "model_name = 'Grant' AND oidc_id = ANY($3::varchar[])",
      );
    });

    it('deduplicates grant ids shared across sessions', async () => {
      await repository.deleteSessions([
        { oidcId: 'session-1', createdAt: new Date(), grantIds: ['grant-a'] },
        {
          oidcId: 'session-2',
          createdAt: new Date(),
          grantIds: ['grant-a', 'grant-b'],
        },
      ]);

      expect(mockQuery.mock.calls[0][1][2]).toEqual(['grant-a', 'grant-b']);
    });
  });

  describe('deleteAllForAccount', () => {
    it('deletes every account-bound model kind for the account', async () => {
      mockQuery.mockResolvedValue([{ model_name: 'Session', count: '2' }]);

      const result = await repository.deleteAllForAccount('user-1');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('model_name = ANY($1::varchar[])');
      expect(params[0]).toEqual([...ACCOUNT_BOUND_MODELS]);
      expect(params[1]).toBe('user-1');
      expect(result).toEqual([{ modelName: 'Session', count: 2 }]);
    });

    it('includes Grant and the token kinds in the account-bound list', () => {
      expect(ACCOUNT_BOUND_MODELS).toContain('Grant');
      expect(ACCOUNT_BOUND_MODELS).toContain('AccessToken');
      expect(ACCOUNT_BOUND_MODELS).toContain('RefreshToken');
    });

    it('excludes model kinds that are never bound to a user', () => {
      expect(ACCOUNT_BOUND_MODELS).not.toContain('ClientCredentials');
      expect(ACCOUNT_BOUND_MODELS).not.toContain('ReplayDetection');
      expect(ACCOUNT_BOUND_MODELS).not.toContain('Interaction');
    });

    it('also removes rows linked only by grant_id', async () => {
      await repository.deleteAllForAccount('user-1');

      expect(mockQuery.mock.calls[0][0]).toContain(
        'grant_id IN (SELECT oidc_id FROM targeted)',
      );
    });
  });
});
