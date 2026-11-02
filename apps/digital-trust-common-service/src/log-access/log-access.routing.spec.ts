import type { Server } from 'http';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { LogAccessController } from './log-access.controller';
import { LogAccessService } from './log-access.service';

describe('log access endpoint routing', () => {
  let app: INestApplication;
  const resolveScope = jest.fn().mockResolvedValue('t-abc');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LogAccessController],
      providers: [{ provide: LogAccessService, useValue: { resolveScope } }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it.each([
    '/internal/log-access/check',
    '/internal/log-access/check/loki/api/v1/query_range',
    '/INTERNAL/Log-Access/check',
  ])(
    'answers 404 for %s on a listener that is not the internal one',
    async (path) => {
      await request(app.getHttpServer() as Server)
        .get(path)
        .expect(404);
      expect(resolveScope).not.toHaveBeenCalled();
    },
  );
});
