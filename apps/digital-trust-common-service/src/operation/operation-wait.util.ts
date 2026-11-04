import { BadRequestException } from '@nestjs/common';

export function parseOperationWait(prefer?: string): number {
  const preferences = (prefer ?? '').split(',').map((value) => value.trim());
  const waits = preferences.filter((value) => /^wait(?:\s*=|$)/i.test(value));
  if (waits.length === 0) {
    return 0;
  }
  const match = /^wait\s*=\s*(?:"(\d+)"|(\d+))$/i.exec(waits[0]);
  const seconds = match ? Number(match[1] ?? match[2]) : NaN;
  if (waits.length !== 1 || !Number.isSafeInteger(seconds)) {
    throw new BadRequestException('Prefer wait must be a non-negative integer');
  }
  return Math.min(seconds, 30);
}
