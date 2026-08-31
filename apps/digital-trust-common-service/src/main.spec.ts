import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { DevSeedService } from './seed/dev-seed.service';
import { shouldRunDevSeedOnStart } from './seed/seed-on-start.util';

jest.mock('@app/oidc', () => ({
  OidcMountService: { mount: jest.fn() },
}));
jest.mock('@nestjs/core', () => ({
  NestFactory: { create: jest.fn() },
}));
jest.mock('./app.config', () => ({ configureApp: jest.fn() }));
jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));
jest.mock('./seed/dev-seed.service', () => ({
  DevSeedService: class DevSeedService {},
}));
jest.mock('./seed/seed-on-start.util', () => ({
  shouldRunDevSeedOnStart: jest.fn(),
}));
jest.mock('./swagger/swagger.service', () => ({
  SwaggerService: { setupSwagger: jest.fn() },
}));

const mockNestFactory = jest.mocked(NestFactory);
const mockShouldRunDevSeedOnStart = jest.mocked(shouldRunDevSeedOnStart);

describe('application bootstrap', () => {
  it('initializes lifecycle hooks before running the startup seed', async () => {
    const calls: string[] = [];
    const configService = {
      get: jest.fn().mockReturnValue('3000'),
    };
    const seedService = {
      run: jest.fn().mockImplementation(() => {
        calls.push('seed');
        return Promise.resolve();
      }),
    };
    let resolveListen!: () => void;
    const listened = new Promise<void>((resolve) => {
      resolveListen = resolve;
    });
    const app = {
      enableShutdownHooks: jest.fn(),
      get: jest
        .fn()
        .mockImplementation((token: { name?: string }) =>
          token.name === ConfigService.name ? configService : seedService,
        ),
      init: jest.fn().mockImplementation(() => {
        calls.push('init');
        return Promise.resolve();
      }),
      listen: jest.fn().mockImplementation(() => {
        calls.push('listen');
        resolveListen();
        return Promise.resolve();
      }),
    };

    mockNestFactory.create.mockResolvedValue(app as never);
    mockShouldRunDevSeedOnStart.mockReturnValue(true);

    jest.isolateModules(() => {
      jest.requireActual('./main');
    });
    await listened;

    expect(app.get).toHaveBeenCalledWith(DevSeedService);
    expect(calls).toEqual(['init', 'seed', 'listen']);
  });
});
