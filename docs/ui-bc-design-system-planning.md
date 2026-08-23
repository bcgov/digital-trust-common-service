# UI: BC Design System planning

Knowledge base for aligning the admin UI (`apps/ui`, built in #82) with the
BC (Gov) Design System. Started 2026-08-13; **implemented 2026-08-22 in #180**
— see "Implementation decisions" below for what was actually done.

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

## Implementation decisions (2026-08-22, #180)

- **Token bridge, not token copies.** `src/index.css` imports
  `@bcgov/design-tokens/css/variables.css` and maps shadcn's theme variables
  onto it by `var()` reference (`--primary: var(--surface-color-primary-button-default)`
  etc.), so a design-tokens upgrade flows through without editing the mapping.
  New code keeps styling with the shadcn-side tokens (`bg-primary`, …).
- **Font:** `@bcgov/bc-sans/css/BC_Sans.css` (declares family `'BC Sans'`,
  the name the BCDS tokens reference; the package's other file `BCSans.css`
  declares `'BCSans'`, which they don't). Geist removed.
- **Dark mode dropped.** design-tokens v5 is light-only (only `*-invert`
  tokens exist, no dark palette). The `.dark` token block was deleted; the
  `@custom-variant dark` line is kept deliberately so the `dark:` utilities
  still present in vendored shadcn components stay pinned to a class nothing
  sets (removing the variant would revert them to `prefers-color-scheme` and
  half-apply on dark-OS machines).
- **Focus:** one global `:focus-visible` base rule (solid 2px
  `--surface-color-border-active`, 2px offset — same treatment as BCDS
  react-components). Vendored components' per-element soft rings
  (`focus-visible:ring-3 …`) were removed rather than restyled. The universal
  `*` rule presets outline color/width so `transition-all`/`transition-colors`
  elements don't animate the outline in from `currentcolor`.
- **Radius:** `--radius: var(--layout-border-radius-medium)` (4px) — shadcn's
  `rounded-lg` (buttons/inputs) lands on BCDS "medium", `rounded-xl` (cards)
  on ≈"large".
- **Links:** `--color-link`/`--color-link-hover` theme tokens
  (BCDS link colour, active-blue hover); the Button `link` variant is
  underlined by default per BC Gov convention.
- **Official header adopted** (`@bcgov/design-system-react-components`):
  `<Header>` in `AppShell` (tenant switcher + account menu as children) and on
  the login page. Its 1100px container max-width is overridden in `index.css`
  — the admin shell is full-width. Measured cost: entry chunk 154 → 172 kB
  gzip (react-aria-components mostly tree-shakes out).
- **Footer skipped.** The BC Gov footer (land acknowledgement + link blocks)
  is designed for public content sites; inside a logged-in sidebar admin shell
  it would sit oddly in scroll content. Revisit if requirements say otherwise
  (a copyright-only slim variant exists: `hideAcknowledgement` +
  `hideLogoAndLinks`).
- **Contrast:** BC gold appears only in the logo (never as text). Checked
  pairs all clear WCAG AA: body `#2D2D2D` on `#FAF9F8`, muted `#474543` on
  `#F3F2F1`, white on primary `#013366`, sidebar-active `#013366` on
  `#F1F8FE`.

## Still open

- shadcn's soft `destructive` button (red-tinted fill, red text) differs from
  BCDS's filled danger button (`#CE3E39` bg, white text). Nothing renders a
  destructive button yet; align it via
  `--surface-color-primary-danger-button-*` when one first ships.
- Tenant status badges use default/secondary variants; BCDS support tokens
  (`--support-*`) are available if status colours (warning/danger) are wanted.

## References

- Design system docs: https://www2.gov.bc.ca/gov/content/digital/design-system
- Repo: https://github.com/bcgov/design-system
- Our theming surface: `apps/ui/src/index.css` (token definitions),
  `apps/ui/components.json` (shadcn config), `apps/ui/src/components/ui/`
  (vendored component source).
