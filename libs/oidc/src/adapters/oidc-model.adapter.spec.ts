import type { Repository } from 'typeorm';

import { OidcModel } from '../entities/oidc-model.entity';

import { OidcModelAdapter } from './oidc-model.adapter';

describe('OidcModelAdapter', () => {
  let mockFindOne: jest.Mock;
  let mockUpsert: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;
  let adapter: OidcModelAdapter;

  beforeEach(() => {
    mockFindOne = jest.fn();
    mockUpsert = jest.fn().mockResolvedValue(undefined);
    mockUpdate = jest.fn();
    mockDelete = jest.fn();

    const repository = {
      findOne: mockFindOne,
      upsert: mockUpsert,
      update: mockUpdate,
      delete: mockDelete,
    } as unknown as Repository<OidcModel>;

    adapter = new OidcModelAdapter('AccessToken', repository);
  });

  describe('upsert', () => {
    it('performs an atomic upsert keyed on modelName/oidcId', async () => {
      await adapter.upsert(
        'oidc-id-1',
        { grantId: 'grant-1', userCode: 'code-1', uid: 'uid-1' },
        3600,
      );

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'AccessToken',
          oidcId: 'oidc-id-1',
          grantId: 'grant-1',
          userCode: 'code-1',
          uid: 'uid-1',
          consumedAt: null,
        }),
        { conflictPaths: ['modelName', 'oidcId'] },
      );
    });

    it('resets consumedAt to null on re-upsert', async () => {
      await adapter.upsert('oidc-id-1', {}, 3600);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ consumedAt: null }),
        expect.any(Object),
      );
    });

    it('stores a null expiresAt when expiresIn is not positive', async () => {
      await adapter.upsert('oidc-id-1', {}, 0);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: null }),
        expect.any(Object),
      );
    });

    it('does not throw when the same id is upserted concurrently', async () => {
      await expect(
        Promise.all([
          adapter.upsert('oidc-id-1', { grantId: 'a' }, 3600),
          adapter.upsert('oidc-id-1', { grantId: 'b' }, 3600),
        ]),
      ).resolves.toBeDefined();

      expect(mockUpsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('find', () => {
    it('returns undefined when no row exists', async () => {
      mockFindOne.mockResolvedValue(null);

      await expect(adapter.find('missing')).resolves.toBeUndefined();
    });

    it('returns undefined when the row has expired', async () => {
      mockFindOne.mockResolvedValue({
        payload: { foo: 'bar' },
        expiresAt: new Date(Date.now() - 1000),
        consumedAt: null,
      });

      await expect(adapter.find('expired')).resolves.toBeUndefined();
    });

    it('returns the payload with a consumed timestamp when consumed', async () => {
      const consumedAt = new Date();
      mockFindOne.mockResolvedValue({
        payload: { foo: 'bar' },
        expiresAt: null,
        consumedAt,
      });

      await expect(adapter.find('consumed')).resolves.toEqual({
        foo: 'bar',
        consumed: Math.floor(consumedAt.getTime() / 1000),
      });
    });

    it('returns the payload as-is when active and not consumed', async () => {
      mockFindOne.mockResolvedValue({
        payload: { foo: 'bar' },
        expiresAt: null,
        consumedAt: null,
      });

      await expect(adapter.find('active')).resolves.toEqual({ foo: 'bar' });
    });
  });

  describe('findByUserCode', () => {
    it('queries by modelName and userCode', async () => {
      mockFindOne.mockResolvedValue(null);

      await adapter.findByUserCode('user-code-1');

      expect(mockFindOne).toHaveBeenCalledWith({
        where: { modelName: 'AccessToken', userCode: 'user-code-1' },
      });
    });
  });

  describe('findByUid', () => {
    it('queries by modelName and uid', async () => {
      mockFindOne.mockResolvedValue(null);

      await adapter.findByUid('uid-1');

      expect(mockFindOne).toHaveBeenCalledWith({
        where: { modelName: 'AccessToken', uid: 'uid-1' },
      });
    });
  });

  describe('consume', () => {
    it('sets consumedAt for the matching row', async () => {
      await adapter.consume('oidc-id-1');

      expect(mockUpdate).toHaveBeenCalledWith(
        { modelName: 'AccessToken', oidcId: 'oidc-id-1' },
        { consumedAt: expect.any(Date) as Date },
      );
    });
  });

  describe('destroy', () => {
    it('deletes the matching row', async () => {
      await adapter.destroy('oidc-id-1');

      expect(mockDelete).toHaveBeenCalledWith({
        modelName: 'AccessToken',
        oidcId: 'oidc-id-1',
      });
    });
  });

  describe('revokeByGrantId', () => {
    it('deletes all rows for the grant', async () => {
      await adapter.revokeByGrantId('grant-1');

      expect(mockDelete).toHaveBeenCalledWith({
        modelName: 'AccessToken',
        grantId: 'grant-1',
      });
    });
  });
});
