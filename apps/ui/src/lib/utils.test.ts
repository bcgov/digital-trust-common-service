import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('keeps BCDS font-size utilities alongside a text colour', () => {
    // tailwind-merge reads `text-body` as a colour unless it is registered as
    // a font size, and would drop it in favour of the colour that follows.
    expect(cn('text-body', 'text-muted-foreground')).toBe(
      'text-body text-muted-foreground',
    );
    expect(cn('text-h5', 'text-foreground')).toBe('text-h5 text-foreground');
  });

  it('still treats the BCDS font sizes as conflicting with each other', () => {
    expect(cn('text-body', 'text-h5')).toBe('text-h5');
    expect(cn('text-h5', 'text-sm')).toBe('text-sm');
  });

  it('still merges conflicting text colours', () => {
    expect(cn('text-red-500', 'text-muted-foreground')).toBe(
      'text-muted-foreground',
    );
  });
});
