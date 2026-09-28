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

    return parsed as Cursor;
  } catch {
    throw new BadRequestException('Invalid pagination cursor.');
  }
}
