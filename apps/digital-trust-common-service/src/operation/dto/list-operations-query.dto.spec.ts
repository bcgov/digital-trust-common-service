import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { OperationState } from '../operation.entity';

import { ListOperationItemsQueryDto } from './list-operation-items-query.dto';
import { ListOperationsQueryDto } from './list-operations-query.dto';

describe.each([
  { name: 'ListOperationsQueryDto', metatype: ListOperationsQueryDto },
  { name: 'ListOperationItemsQueryDto', metatype: ListOperationItemsQueryDto },
])('$name', ({ metatype }) => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const validate = (query: object): Promise<ListOperationItemsQueryDto> =>
    pipe.transform(query, { type: 'query', metatype });

  it('accepts omitted filters without assigning pagination defaults', async () => {
    const result = await validate({});

    expect(result).toBeInstanceOf(metatype);
    expect(result.state).toBeUndefined();
    expect(result.cursor).toBeUndefined();
    expect(result.limit).toBeUndefined();
  });

  it.each(Object.values(OperationState))('accepts state %s', async (state) => {
    await expect(validate({ state })).resolves.toMatchObject({ state });
  });

  it.each(['1', '20', '100'])(
    'converts limit %s to a number',
    async (limit) => {
      await expect(validate({ limit })).resolves.toMatchObject({
        limit: Number(limit),
      });
    },
  );

  it('preserves the opaque cursor for later decoding', async () => {
    await expect(validate({ cursor: 'opaque-cursor' })).resolves.toMatchObject({
      cursor: 'opaque-cursor',
    });
  });

  it.each([
    { state: 'unknown' },
    { state: ['pending', 'failed'] },
    { cursor: ['cursor-one', 'cursor-two'] },
    { cursor: {} },
    { limit: '0' },
    { limit: '-1' },
    { limit: '101' },
    { limit: '1.5' },
    { limit: 'invalid' },
    { limit: '' },
    { unexpected: 'value' },
  ])('rejects invalid query %j with a 400', async (query) => {
    await expect(validate(query)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('operation type filtering', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it.each(['credential.offer', 'credential.offer-batch', 'future.operation'])(
    'accepts type %s without limiting it to the current catalog',
    async (type) => {
      await expect(
        pipe.transform(
          { type, state: 'pending', limit: '20' },
          { type: 'query', metatype: ListOperationsQueryDto },
        ),
      ).resolves.toMatchObject({ type, state: 'pending', limit: 20 });
    },
  );

  it.each(['', 'x'.repeat(51), ['credential.offer'], {}])(
    'rejects invalid operation type %j',
    async (type) => {
      await expect(
        pipe.transform(
          { type },
          { type: 'query', metatype: ListOperationsQueryDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rejects a type filter on batch items', async () => {
    await expect(
      pipe.transform(
        { type: 'credential.offer' },
        { type: 'query', metatype: ListOperationItemsQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
