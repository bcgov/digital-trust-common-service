/** Prefix for generated OAuth client_id values (AU-06). */
export const OAUTH_CLIENT_ID_PREFIX = 'dtcs_';

export const UI_CLIENT_ID = 'dtsc-ui';
export const ADMIN_CLIENT_ID = 'dtsc-platform-admin';
export const RESERVED_OAUTH_CLIENT_IDS: ReadonlySet<string> = new Set([
  UI_CLIENT_ID,
  ADMIN_CLIENT_ID,
]);
