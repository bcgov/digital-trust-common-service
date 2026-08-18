// Enforces the commit convention documented in .github/copilot-instructions.md.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'refactor',
        'test',
        'chore',
        'build',
        'ci',
        'perf',
        'style',
        'revert',
      ],
    ],
    // Scope stays optional; the enum only constrains scopes that are supplied.
    'scope-enum': [
      2,
      'always',
      [
        'auth',
        'oidc',
        'database',
        'credential',
        'tenant',
        'audit',
        'connector',
        'oauth-client',
        'role-scope',
        'jobs',
        'swagger',
        'helm',
        'ci',
        'docs',
        'deps',
      ],
    ],
    'header-max-length': [2, 'always', 72],
  },
};
