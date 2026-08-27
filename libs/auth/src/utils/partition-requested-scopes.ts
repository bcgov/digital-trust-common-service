export interface PartitionRequestedScopesInput {
  requestedScopes: readonly string[];
  /** Scopes this path is willing to grant (catalog, deployment allowlist, role grants, protocol scopes). */
  allowedScopes: Iterable<string>;
  /** Scopes the actor already holds. Ignored when `isPlatformAdmin` is true. */
  actorScopes: Iterable<string>;
  isPlatformAdmin?: boolean;
}

export interface PartitionRequestedScopesResult {
  grantedScopes: string[];
  deniedScopes: string[];
}

/**
 * Shared allow/deny split for requested OAuth/OIDC scopes.
 *
 * A scope is granted when it is in `allowedScopes` and either the actor holds
 * it or the caller is platform-admin. Used by OAuth client registration and
 * the interactive OIDC grant path so those rules cannot drift.
 */
export function partitionRequestedScopes(
  input: PartitionRequestedScopesInput,
): PartitionRequestedScopesResult {
  const allowed = toSet(input.allowedScopes);
  const actor = toSet(input.actorScopes);
  const grantedScopes: string[] = [];
  const deniedScopes: string[] = [];

  for (const scope of input.requestedScopes) {
    const permitted =
      allowed.has(scope) &&
      (Boolean(input.isPlatformAdmin) || actor.has(scope));

    if (permitted) {
      grantedScopes.push(scope);
    } else {
      deniedScopes.push(scope);
    }
  }

  return { grantedScopes, deniedScopes };
}

function toSet(values: Iterable<string>): Set<string> {
  return new Set<string>(values);
}
