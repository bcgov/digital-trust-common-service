import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';

import { Connection, ConnectionState } from './connection.entity';
import { ConnectionRepository } from './connection.repository';

describe('ConnectionRepository', () => {
  let repository: ConnectionRepository;
  let mockRepo: jest.Mocked<Partial<Repository<Connection>>>;

  beforeEach(async () => {
    mockRepo = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionRepository,
        {
          provide: getRepositoryToken(Connection),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get(ConnectionRepository);
  });

  describe('abandonAllForTenant', () => {
    it('abandons only non-terminal connections for the tenant', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: 4,
      });

      await expect(repository.abandonAllForTenant('t1')).resolves.toBe(4);

      expect(mockRepo.update).toHaveBeenCalledWith(
        {
          tenantId: 't1',
          state: Not(
            In([ConnectionState.COMPLETED, ConnectionState.ABANDONED]),
          ),
        },
        { state: ConnectionState.ABANDONED },
      );
    });

    it('returns 0 when the update reports no affected rows', async () => {
      (mockRepo.update as jest.Mock).mockResolvedValue({
        affected: undefined,
      });

      await expect(repository.abandonAllForTenant('t1')).resolves.toBe(0);
    });
  });
});
