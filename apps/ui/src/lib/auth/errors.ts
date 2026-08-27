/**
 * The provider itself refused the sign-in — `?error=access_denied` back on
 * the callback, e.g. the user's role was denied the requested scopes — as
 * distinct from the code exchange failing. The auth client raises it only
 * after matching the callback's `state` to a transaction it started, so
 * `description` is the provider's own text, not something pasted into a
 * crafted callback URL.
 */
export class AuthProviderError extends Error {
  public readonly code: string;
  public readonly description: string | null;

  public constructor(code: string, description: string | null = null) {
    super(description ?? code);
    this.name = 'AuthProviderError';
    this.code = code;
    this.description = description;
  }
}
