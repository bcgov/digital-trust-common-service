import { BadRequestException } from '@nestjs/common';

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
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Cursor;

    if (!parsed?.createdAt || !parsed?.id) {
      throw new Error('invalid cursor shape');
    }

    return parsed;
  } catch {
    throw new BadRequestException('Invalid pagination cursor.');
  }
}
