/// <reference types="node" />
// Guards for the BC Design System integration decisions (#180 / PR #194).
// Both failure modes are silent at build time: an unknown var() just drops
// the declaration at computed-value time, and `npx shadcn add` writes stock
// files that reintroduce per-element focus rings.
//
// CSS files are read with node:fs (hence the reference directive above):
// vitest's `css: false` stubs css imports to '' — even with `?raw`.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const uiRoot = resolve(import.meta.dirname, '../..');

const componentSources = import.meta.glob('../components/ui/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('BC Design System contract', () => {
  it('react-components and design-tokens are in lockstep', () => {
    // The react-components bundle injects its own inlined copy of the
    // tokens, and that copy wins the runtime cascade over the app's
    // variables.css import. Identical versions make that harmless; a drift
    // means the effective palette is silently NOT what package.json says.
    const reactComponentsPkg = JSON.parse(
      readFileSync(
        join(
          uiRoot,
          'node_modules/@bcgov/design-system-react-components/package.json',
        ),
        'utf8',
      ),
    ) as { dependencies: Record<string, string> };
    const tokensPkg = JSON.parse(
      readFileSync(
        join(uiRoot, 'node_modules/@bcgov/design-tokens/package.json'),
        'utf8',
      ),
    ) as { version: string };

    expect(reactComponentsPkg.dependencies['@bcgov/design-tokens']).toBe(
      tokensPkg.version,
    );
  });

  it('every BCDS token referenced in index.css exists in @bcgov/design-tokens', () => {
    const indexCss = readFileSync(join(uiRoot, 'src/index.css'), 'utf8');
    const tokensCss = readFileSync(
      join(uiRoot, 'node_modules/@bcgov/design-tokens/css/variables.css'),
      'utf8',
    );

    const referenced = [
      ...indexCss.matchAll(
        /var\(\s*(--(?:surface|typography|theme|layout|icons|support)-[a-z0-9-]+)/g,
      ),
    ].map((match) => match[1]);
    const defined = new Set(
      [...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
    );

    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((name) => !defined.has(name))).toEqual([]);
  });

  it('vendored shadcn components rely on the global BC focus outline', () => {
    // If this fails after `npx shadcn add`, strip the component's
    // `focus-visible:ring-*`/`outline-none` focus cluster — see README.
    const offenders = Object.entries(componentSources)
      .filter(([, source]) => String(source).includes('focus-visible:ring'))
      .map(([path]) => path);

    expect(Object.keys(componentSources).length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
