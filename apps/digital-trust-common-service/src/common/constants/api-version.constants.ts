/**
 * Centralized API versioning constants (AG-01).
 *
 * These are the single source of truth for the global URI prefix/version
 * applied in `main.ts` (`setGlobalPrefix` + `enableVersioning`). Business
 * controllers should reference `API_VERSION` via `@Controller({ version:
 * API_VERSION })` rather than hardcoding version strings, and any code that
 * needs to render a fully-qualified API path (docs, examples, persisted
 * request context) should build it from `API_BASE_PATH` instead of
 * duplicating the `/api/v1` literal.
 *
 * Per AG-01 decision D2, versioning is explicit: there is no `defaultVersion`
 * configured, so every business controller/route MUST declare `API_VERSION`
 * or it will be served unversioned (unintended). Operational endpoints
 * (health, Swagger) are deliberately version-neutral — see D5 — and must not
 * use these constants.
 */

/** Global URI prefix applied to all versioned business routes. */
export const API_PREFIX = 'api';

/** Current API version segment (rendered as `v${API_VERSION}` in the URL). */
export const API_VERSION = '1';

/** The `v<N>` segment as it appears in the URL, e.g. `v1`. */
export const API_VERSION_SEGMENT = `v${API_VERSION}`;

/** Fully-qualified versioned API base path, e.g. `/api/v1`. */
export const API_BASE_PATH = `/${API_PREFIX}/${API_VERSION_SEGMENT}`;
