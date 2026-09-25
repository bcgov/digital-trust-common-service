import { BadRequestException } from '@nestjs/common';

import { decodeCursor, encodeCursor } from './cursor-pagination';

describe('cursor-pagination', () => {
  it('round-trips a cursor through encode and decode', () => {
    const cursor = { createdAt: '2025-01-15T10:30:00.000Z', id: 'abc-123' };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

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
});
