import { describe, expect, it } from 'vitest';

import en from './en.json';
import fr from './fr.json';

function entriesOf(catalog: object, prefix = ''): [string, string][] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? entriesOf(value as object, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(value)] as [string, string]],
  );
}

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();
}

describe('locale catalogs', () => {
  it('has the same keys in French as in English', () => {
    const keys = (catalog: object) =>
      entriesOf(catalog)
        .map(([key]) => key)
        .sort();
    expect(keys(fr)).toEqual(keys(en));
  });

  it('keeps the English placeholders in every French string', () => {
    const french = new Map(entriesOf(fr));
    for (const [key, text] of entriesOf(en)) {
      expect(placeholdersOf(french.get(key) ?? ''), key).toEqual(
        placeholdersOf(text),
      );
    }
  });
});
