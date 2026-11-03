import { BadRequestException } from '@nestjs/common';
import { isISO8601, isRFC3339, isUUID } from 'class-validator';

/** Keyset cursor shape shared by every paginated list in this service. */
export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { createdAt?: unknown }).createdAt !== 'string' ||
      typeof (parsed as { id?: unknown }).id !== 'string'
    ) {
      throw new Error('invalid cursor shape');
    }

    const cursor = parsed as Cursor;
    if (
      !isRFC3339(cursor.createdAt) ||
      !isISO8601(cursor.createdAt, { strict: true }) ||
      cursor.createdAt.startsWith('0000-') ||
      !Number.isFinite(Date.parse(cursor.createdAt)) ||
      !isUUID(cursor.id)
    ) {
      throw new Error('invalid cursor values');
    }

    return cursor;
  } catch {
    throw new BadRequestException('Invalid pagination cursor.');
  }
}
