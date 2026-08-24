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
- **Font:** BC Sans, self-hosted via our own `@font-face` in `index.css`
  pointing at the `@bcgov/bc-sans` woff2 files (revised in the #194 review
  round — the package's `BC_Sans.css` sets no `font-display`, i.e. invisible
  text while loading, and pulls in all 12 font files). We declare only
  400/700 with `font-display: swap`. The family name must stay `'BC Sans'` —
  it's what the BCDS typography tokens reference (`BCSans.css` declares
  `'BCSans'`, which they don't). Known, accepted: BC Sans has no 500/600, so
  Tailwind `font-medium` renders as regular and `font-semibold` as bold —
  the three-step weight hierarchy in stock shadcn collapses to two; italics
  are synthesized. Geist removed.
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
- **Radius:** `--radius: var(--layout-border-radius-medium)` (4px), and the
  radius steps the components use map to BCDS's discrete tokens —
  `sm` → small (2px), `md`/`lg` → medium (4px), `xl` → large (6px) — instead
  of shadcn's derived fractions (#194 review round). Buttons/inputs
  (`rounded-lg`) land on "medium", cards (`rounded-xl`) on "large".
- **Links:** `--color-link`/`--color-link-hover` theme tokens
  (BCDS link colour, active-blue hover); the Button `link` variant is
  underlined by default per BC Gov convention.
- **Destructive buttons follow BCDS's danger spec** (#194 review round):
  filled `--surface-color-primary-danger-button-default` with white text and
  the BCDS hover, replacing shadcn's soft red-tinted variant. The scaffold's
  shadcn styling carries no design intent — where BCDS specifies a treatment,
  BCDS wins.
- **Official header, behind an app boundary — and BCDS-first as policy.**
  Decided with Lucas in the PR #194 review round (after a brief vendored
  interlude): the project's direction is adopting the BC Design System —
  more `@bcgov/design-system-react-components` components will follow, so
  the package's fixed costs are platform costs, not one-component overhead.
  `src/components/bc-gov-header.tsx` wraps the official `<Header>` as the
  single place that absorbs pre-1.0 prop/class churn. Where BCDS provides a
  component, prefer it; the vendored shadcn primitives fill the gaps (data
  table, dropdown menu, avatar, …). Accepted, knowingly: ~18 kB gzip on the
  entry chunk and 41 style-injected `<style>` tags — the package publishes
  no per-component entry points (an upstream issue on bcgov/design-system
  asking for `sideEffects`/split exports is worth filing).
- **The package's runtime CSS injection has two sharp edges**, both now
  guarded:
  - Injected CSS lands **after** our stylesheet in production builds but
    **before** it in dev — an equal-specificity override of a `.bcds-*`
    class wins in dev and silently loses in prod. Rule: app overrides must
    **out-specify** the package rule, never rely on source order (see the
    full-width header override in `index.css`, verified in `vite preview`).
  - The bundle inlines its **own copy of the design tokens**, which wins the
    cascade over our `variables.css` import. All `@bcgov/*` packages are
    exact-pinned in lockstep, and `src/test/design-system.test.ts` fails if
    react-components' pinned tokens version drifts from the installed one —
    upgrade the three packages together, in one PR.
- **Footer skipped.** The BC Gov footer (land acknowledgement + link blocks)
  is designed for public content sites; inside a logged-in sidebar admin shell
  it would sit oddly in scroll content. Revisit if requirements say otherwise
  (a copyright-only slim variant exists: `hideAcknowledgement` +
  `hideLogoAndLinks`).
- **Contrast:** BC gold appears only in the logo (never as text). Checked
  pairs all clear WCAG AA: body `#2D2D2D` on `#FAF9F8`, muted `#474543` on
  `#F3F2F1`, white on primary `#013366`, sidebar-active `#013366` on
  `#F1F8FE`.

## Guards (added in the #194 review round)

`src/test/design-system.test.ts` fails CI when:

- react-components' pinned `@bcgov/design-tokens` version drifts from the
  installed one — the package's inlined token copy wins the runtime cascade,
  so a drift means the effective palette is silently not what `package.json`
  says;
- a BCDS custom property referenced by `index.css` no longer exists in the
  installed `@bcgov/design-tokens` — otherwise the `var()` drops silently and
  `bg-primary` etc. go transparent; or
- a vendored component in `src/components/ui/` contains `focus-visible:ring`
  — i.e. a stock `npx shadcn add` reintroduced per-element focus rings over
  the global BC outline rule.

The skip-link and focus behaviours were verified against the production
build (`vite preview`), not just the dev server — the two differ in stylesheet
order, which is exactly what bit the original header override.

## Still open

- Tenant status badges use default/secondary variants; BCDS support tokens
  (`--support-*`) are available if status colours (warning/danger) are wanted.
- The shell is desktop-only: fixed 240px sidebar, no drawer/compact mode, and
  the header row overflows below ~600px. Deliberately out of scope for #180
  (pre-existing layout, internal admin tool) — candidate follow-up issue if
  mobile use materialises.
- No dependency automation (Renovate/Dependabot) covers `apps/ui`; when it's
  added, group the `@bcgov/*` packages into one update set.

## References

- Design system docs: https://www2.gov.bc.ca/gov/content/digital/design-system
- Repo: https://github.com/bcgov/design-system
- Our theming surface: `apps/ui/src/index.css` (token definitions),
  `apps/ui/components.json` (shadcn config), `apps/ui/src/components/ui/`
  (vendored component source).
