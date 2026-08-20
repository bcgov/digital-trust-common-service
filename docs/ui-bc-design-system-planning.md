# UI: BC Design System planning

Knowledge base for aligning the admin UI (`apps/ui`, built in #82) with the
BC (Gov) Design System. Started 2026-08-13; package versions verified against
npm that day. Not yet scheduled — candidate follow-up issue once the scaffold
lands.

## What the BC Design System actually is

Delivered as three npm packages, in layers (repo: `bcgov/design-system`):

| Package | Version (2026-08-13) | What it is |
|---|---|---|
| `@bcgov/design-tokens` | 5.0.0 | **The real design system**: colors, typography scale, spacing, borders as CSS variables. Identity is encoded here, not in components. |
| `@bcgov/bc-sans` | 2.1.0 | BC Sans font files. |
| `@bcgov/design-system-react-components` | 0.8.1 | Official React components, built on **React Aria** (`react-aria-components`). Pre-1.0; peers React 16.14–19. |

Key facts about the React components package:

- Coverage is **modest**: form controls, buttons, callouts, the standard BC Gov
  header/footer. It is *not* a complete admin-app kit — no data table, dropdown
  menu, avatar, skeleton, tabs, etc.
- It depends on `@bcgov/design-tokens` itself — components and tokens stay in sync.
- Built on React Aria; our shadcn components are built on Radix (see nuance below).

## Why the shadcn scaffold composes well with BCDS

shadcn components are deliberately identity-agnostic: every component references
theme tokens (`--primary`, `--background`, `--font-sans`, radii) rather than
hardcoded colors, and the component source is **vendored into our repo**
(`apps/ui/src/components/ui/`). Adoption is therefore mostly a mapping exercise:

1. `npm i @bcgov/design-tokens @bcgov/bc-sans` in `apps/ui`.
2. Swap the font: remove the `@fontsource-variable/geist` import in
   `src/index.css` (interim font from the shadcn Nova preset), import BC Sans,
   point `--font-sans` at it.
3. Map BCDS variables onto shadcn's token layer in `src/index.css` —
   `--primary` → BC blue, `--background`/`--muted`/`--border` → BCDS
   surface/grey tokens, radii + focus rings likewise. All vendored components
   restyle automatically; future `npx shadcn add` components inherit the same
   tokens.
4. Anything tokens can't express (BC Gov focus-outline conventions, link
   styling) is a **direct edit to our component source** — no library-override
   fight. This is the practical advantage over theming a closed library.

Traditional BC Gov palette anchors (verify against tokens v5 before use):
BC blue `#013366`, gold accent `#FCBA19`, link blue `#1A5A96`.

## Where the official React components fit

Use them *alongside* shadcn where they are canonical:

- **BC Gov header/footer** — always use the official ones.
- **Form controls / buttons** — optional, if pixel-perfect consistency with
  other BC services is wanted; otherwise token-mapped shadcn equivalents.

They coexist fine with shadcn (both are just React + CSS).

## The one architectural nuance: Radix vs React Aria

- BCDS components → React Aria. Our shadcn setup → Radix (`-b radix` at init).
- Mixing lightly (header/footer + a few form controls) is common practice —
  a bundle/consistency smell, not a correctness problem.
- If deep alignment ever becomes worth it: shadcn 4's CLI supports React Aria
  as its component base (`npx shadcn init -b aria`) — the same foundation BCDS
  uses. Re-initializing our vendored components onto that base is a contained,
  mechanical migration. Not currently justified.

## Applicability judgment

This is an **internal admin/management tool**, not a citizen-facing service.
BC Gov's full look-and-feel expectations bind hardest on public services. For
this app, tokens + BC Sans + the standard header very likely reaches "aligned"
for practical purposes — the cheap path the shadcn choice (#82) deliberately
left open.

## Open questions / to verify when scheduling

- **Dark mode:** does `@bcgov/design-tokens` v5 ship a dark palette? Our shadcn
  theme has light + dark (`.dark` block in `index.css`); if BCDS is light-only,
  decide whether to drop dark mode or derive a dark palette ourselves.
- Exact BCDS token names for the mapping table (inspect the package; names like
  `--surface-color-*` / `--typography-*` — confirm rather than guess).
- Whether the standard BC Gov header is expected/required for an internal admin
  tool behind login.
- Contrast/a11y check after mapping (BC gold on white is a known contrast trap
  for text — gold is an accent, not a text color).

## References

- Design system docs: https://www2.gov.bc.ca/gov/content/digital/design-system
- Repo: https://github.com/bcgov/design-system
- Our theming surface: `apps/ui/src/index.css` (token definitions),
  `apps/ui/components.json` (shadcn config), `apps/ui/src/components/ui/`
  (vendored component source).
