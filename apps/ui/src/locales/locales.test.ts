import { describe, expect, it } from 'vitest';

import en from './en.json';
import fr from './fr.json';

function keysOf(catalog: object, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keysOf(value as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('locale catalogs', () => {
  it('has the same keys in French as in English', () => {
    expect(keysOf(fr).sort()).toEqual(keysOf(en).sort());
  });
});
