// Mock the TypeOrmModule to prevent configuration errors during test import
jest.mock('@nestjs/typeorm', () => ({
  TypeOrmModule: {
    forRootAsync: jest.fn(() => ({
      module: 'TypeOrmModule',
    })),
  },
}));

import { DatabaseModule } from './database.module';

describe('DatabaseModule', () => {
  it('should be defined', () => {
    expect(DatabaseModule).toBeDefined();
  });
});
