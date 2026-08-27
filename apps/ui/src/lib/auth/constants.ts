/**
 * Where a sign-in lands when the user had no particular destination in mind.
 *
 * Tenant selection rather than the dashboard: a user may hold membership in
 * more than one tenant, and almost everything the UI does is scoped to one
 * of them, so picking a tenant is the first real step after signing in. A
 * deep link the user was interrupted on still wins over this.
 */
export const POST_LOGIN_PATH = '/tenants';

/**
 * Where the OIDC provider redirects back to, after authorization and after an
 * RP-initiated logout respectively.
 *
 * Both are registered on the OIDC client (see the SPA client in the dev seed),
 * and a mismatch is only reported by the provider — after the browser has
 * already left the app, a long way from the edit that caused it. So each is
 * spelled once, here, and imported by both the router and the auth client.
 */
export const AUTH_CALLBACK_PATH = '/auth/callback';
export const POST_LOGOUT_PATH = '/login';
