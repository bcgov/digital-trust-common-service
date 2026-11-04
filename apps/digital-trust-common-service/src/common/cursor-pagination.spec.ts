import { BadRequestException } from '@nestjs/common';

import { decodeCursor, encodeCursor } from './cursor-pagination';

describe('cursor-pagination', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';

  it('round-trips a cursor through encode and decode', () => {
    const cursor = { createdAt: '2025-01-15T10:30:00.000Z', id };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('preserves microsecond precision without normalizing the timestamp', () => {
    const cursor = { createdAt: '2025-01-15T10:30:00.123456Z', id };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    '2024-02-29T10:30:00.000Z',
    '2025-01-15T00:30:00.123456+05:30',
    '2025-01-15T23:30:00.123456-05:30',
  ])('preserves valid calendar dates and offsets %s', (createdAt) => {
    const cursor = { createdAt, id };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    'not-a-date',
    '',
    '2025-02-30T10:30:00.000Z',
    '2025-13-15T10:30:00.000Z',
    '2025-01-15T25:30:00.000Z',
    '0000-01-01T00:00:00.000Z',
    '2025-W03-3',
  ])('rejects invalid SQL timestamp values %j', (createdAt) => {
    expect(() => decodeCursor(encodeCursor({ createdAt, id }))).toThrow(
      BadRequestException,
    );
  });

  it.each(['not-a-uuid', '', '123e4567-e89b-42d3-a456-42661417400g'])(
    'rejects invalid UUID values %j',
    (invalidId) => {
      expect(() =>
        decodeCursor(
          encodeCursor({
            createdAt: '2025-01-15T10:30:00.000Z',
            id: invalidId,
          }),
        ),
      ).toThrow(BadRequestException);
    },
  );

  it('throws BadRequestException for a malformed cursor', () => {
    expect(() => decodeCursor('not-valid')).toThrow(BadRequestException);
  });

  it('throws BadRequestException when the decoded payload is missing fields', () => {
    const malformed = Buffer.from(
      JSON.stringify({ id: 'abc-123' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeCursor(malformed)).toThrow(BadRequestException);
  });

  it('throws BadRequestException when a field is not a string', () => {
    const malformed = Buffer.from(
      JSON.stringify({ createdAt: 123, id: 'abc-123' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeCursor(malformed)).toThrow(BadRequestException);
  });
});
