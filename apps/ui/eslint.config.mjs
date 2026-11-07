// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import checkFile from 'eslint-plugin-check-file';
import i18next from 'eslint-plugin-i18next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Class names that bypass the BCDS tokens. Written without "/" because
// esquery ends a selector regex at the first slash.
const NON_BCDS_CLASS = String.raw`/(^|[\s:])(text-(xs|sm|base|lg|[2-9]?xl)|(text|bg|border)-(muted-foreground|muted|foreground|destructive|card|popover|accent|secondary|primary)|(text|bg|border)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+)(?![\w-])/`;

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      'coverage/**',
      'src/lib/api/types.gen.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  reactRefresh.configs.vite,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'check-file': checkFile,
    },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { 'src/**/*.{js,jsx,ts,tsx}': 'KEBAB_CASE' },
        { ignoreMiddleExtensions: true },
      ],
    },
  },
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // shadcn-managed primitives export variant helpers alongside components.
    files: ['src/components/common/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // UI text comes from src/locales; the demo pages are not shipped copy.
    ...i18next.configs['flat/recommended'],
    files: ['src/**/*.tsx'],
    ignores: ['**/*.test.tsx', 'src/test/**', 'src/demo/**'],
    rules: {
      // Attributes are checked only when they carry user-facing text;
      // routing, form names and data-* values are not copy.
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            include: [
              'aria-(label|description|placeholder|roledescription|valuetext)',
              'alt',
              'title',
              'placeholder',
              'label',
              'description',
              'message',
              'heading',
              'tooltip',
              '[a-z]+(Label|Message|Text|Title|Description)',
            ],
            exclude: ['.*'],
          },
        },
      ],
    },
  },
  {
    // Screens already on BC Gov components take type and colour from the
    // BCDS tokens. Tailwind text sizes, shadcn theme colours and the raw
    // Tailwind palette drift from the Figma frames, so they are rejected
    // here. Add a screen's files once it has been migrated.
    files: [
      'src/pages/tenants-page.tsx',
      'src/pages/tenant-users-page.tsx',
      'src/pages/connectors-page.tsx',
      'src/pages/credential-definitions-page.tsx',
      'src/pages/create-or-edit-credential-definition-page.tsx',
      'src/components/tenant/**',
      'src/components/tenant-user/**',
      'src/components/connector/**',
      'src/components/credential-definition/**',
      'src/components/common/empty.tsx',
      'src/components/common/page-header.tsx',
      'src/components/common/query-status.tsx',
    ],
    // The tenant switcher lives in the app shell, which moves over with the
    // dashboard.
    ignores: ['**/*.test.tsx', 'src/components/tenant/tenant-switcher.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...['Literal', 'TemplateElement'].map((node) => ({
          selector: `${node}[${node === 'Literal' ? 'value' : 'value.raw'}=${NON_BCDS_CLASS}]`,
          message:
            'Use BCDS tokens (text-body, text-small-body, text-(--typography-color-*), text-(--surface-color-*)) instead of Tailwind sizes, shadcn colours or the Tailwind palette.',
        })),
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  prettier,
);
