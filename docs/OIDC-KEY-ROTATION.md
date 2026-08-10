# OIDC Key Rotation

How to generate, roll, and retire the key material the OIDC provider signs with.

Two independent pieces of key material are involved, and they rotate differently:

| Material | Where it lives | Rotating it invalidates |
|---|---|---|
| RS256 signing JWKS | `oidc-keys.json` in the OIDC signing Secret, mounted at `OIDC_KEYS_PATH` (default `/etc/oidc/oidc-keys.json`) | Issued JWT access / client-credentials tokens, unless the old key is retained for verification (refresh tokens are opaque and unaffected — see Pass 2) |
| Cookie signing secrets | `OIDC_COOKIE_KEYS` in the same Secret | Interactive login sessions and in-flight authorization requests |

## How key selection works

`OidcKeysService` loads the JWKS at startup and hands it to `oidc-provider`. Every key in the array is published at `/oidc/jwks` for verification, but only one signs.

oidc-provider picks the signing key with `keystore.selectForSign({ alg, use })` and takes the first result. Its internal filter sorts candidates by a score that only counts whether `alg` and `use` are present, so keys that all carry `alg: RS256` and `use: sig` score identically. `Array.prototype.sort` is stable, which means equally-scored keys keep their original order.

**The first key in the `keys` array signs. Every other key still verifies.** That property is what makes zero-downtime rotation possible, and it is why `scripts/generate-oidc-keys.mjs --append` prepends rather than appends to the array.

Verification is looked up by `kid`, so a token signed by an older key keeps validating for as long as that key remains in the JWKS.

## Requirements

- Every API pod must load the **same** JWKS. The signing key is not node-local: with divergent keys, a token minted by one pod fails verification against another pod's `/oidc/jwks`. The chart mounts one Secret into every replica for exactly this reason.
- Keys must carry private material (the `d` parameter). `OidcKeysService` rejects a public-only JWKS at startup.
- Only RSA/RS256 keys are supported today.
- In production the service refuses to start if the JWKS file is missing. It never generates one for you.

## First issuance

```bash
node scripts/generate-oidc-keys.mjs oidc-keys.json
# or: npm run --silent oidc:generate-keys > oidc-keys.json
```

Create the Secret the environment's values file expects. `values-dev/test/prod.yaml` set `oidcSigning.create: false` and point at a pre-provisioned Secret named `digital-trust-common-service-{env}-oidc-signing`:

```bash
oc create secret generic digital-trust-common-service-dev-oidc-signing \
  -n <namespace> \
  --from-file=oidc-keys.json=oidc-keys.json \
  --from-literal=OIDC_COOKIE_KEYS="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)"
```

Both keys must be present: `oidc-keys.json` is mounted as a file, `OIDC_COOKIE_KEYS` is injected as an environment variable from the same Secret.

Delete your local copy afterwards. It holds private key material and must never be committed.

PR preview environments are the exception: `values-pr.yaml` sets `oidcSigning.create: true`, and `pr-deploy.yml` generates a key on the first deploy and reuses it on subsequent ones.

## Rotating the signing key

Rotation is two passes. The first introduces the new key while the old one keeps verifying; the second removes the old key once nothing signed by it can still be valid.

> **Multi-replica rollout window.** `--append` makes the new key the *signer*
> immediately (it is prepended). During a rolling restart the fleet is briefly
> mixed: new pods already sign with `new` and publish `[new, old]`, while
> not-yet-restarted pods still publish only `[old]`. A token minted by a new pod
> whose `/oidc/jwks` request is load-balanced to an old pod fails verification
> until the rollout completes (typically seconds, bounded by `rollout status`).
> With a single replica there is no window. For a zero-gap rollout under multiple
> replicas, split it into two deploys: first publish the new key **without**
> signing (append it to the *end* of the `keys` array so `old` stays first),
> roll out, then move it to the front and roll out again to activate it. The
> steps below use the single-pass `--append`, which is the right default for the
> current single-writer, short-TTL setup.

### Pass 1: introduce the new signing key

1. Fetch the current JWKS from the live Secret.

   ```bash
   oc get secret digital-trust-common-service-dev-oidc-signing -n <namespace> \
     -o jsonpath='{.data.oidc-keys\.json}' | base64 -d > oidc-keys.json
   ```

2. Prepend a freshly generated key, keeping the existing ones.

   ```bash
   node scripts/generate-oidc-keys.mjs --append oidc-keys.json
   # or via the npm alias (note the `--` so npm forwards the path):
   #   npm run oidc:rotate-keys -- oidc-keys.json
   ```

   The file now holds the new key first, followed by the previous key(s). Confirm before proceeding:

   ```bash
   python3 -c "import json;print([k['kid'] for k in json.load(open('oidc-keys.json'))['keys']])"
   ```

3. Update the Secret in place.

   ```bash
   oc set data secret/digital-trust-common-service-dev-oidc-signing \
     -n <namespace> --from-file=oidc-keys.json=oidc-keys.json
   ```

4. Restart the API so every pod reloads the JWKS. The keys are read once at startup, so a running pod will not pick up the change on its own. A mounted Secret also takes up to a kubelet sync period to appear on disk, so restart rather than relying on the projection.

   ```bash
   oc rollout restart deployment/digital-trust-common-service -n <namespace>
   oc rollout status deployment/digital-trust-common-service -n <namespace>
   ```

5. Verify both keys are published and new tokens use the new `kid`.

   ```bash
   curl -s https://<host>/oidc/jwks | python3 -c "import json,sys;print([k['kid'] for k in json.load(sys.stdin)['keys']])"
   ```

   Tokens minted from now on carry the new `kid` in their JWT header. Tokens minted before the restart still verify against the retained key.

At this point rotation is complete from a caller's perspective. No client sees an interruption.

### Pass 2: retire the old key

Wait until nothing signed by the old key can still be valid. The signing key only
covers **JWT-signed artifacts**. This app configures `accessTokenFormat: 'jwt'`
(via Resource Indicators), so access and client-credentials tokens are signed
JWTs. Refresh tokens carry no format override, so oidc-provider keeps them as
**opaque** adapter references — they are validated by database lookup, not by the
JWKS, and are therefore **not** invalidated by signing-key rotation.

| Token | Format | Default TTL | Depends on signing key? |
|---|---|---|---|
| Access / client credentials | JWT (RS256) | 300s (5 min), `OIDC_ACCESS_TOKEN_TTL_SECONDS` | Yes |
| Refresh | Opaque (adapter) | 28800s (8 hours), `OIDC_REFRESH_TOKEN_TTL_SECONDS` | No |

Retirement is therefore gated by the longest-lived **JWT** TTL — the access-token
TTL (5 minutes by default), not the refresh-token TTL. Wait at least
`OIDC_ACCESS_TOKEN_TTL_SECONDS` after the pass 1 rollout finished so no unexpired
JWT was signed by the old key. (A refresh exchange during that window mints its
new access-token JWT with the *current* key, so it is unaffected.) Then drop the
old key by regenerating a single-key JWKS, or by editing the array down to just
the current signer:

```bash
python3 -c "
import json
d = json.load(open('oidc-keys.json'))
json.dump({'keys': d['keys'][:1]}, open('oidc-keys.json','w'), indent=2)
"
```

Update the Secret and restart exactly as in steps 3 and 4. Keeping a retired key around longer than necessary widens the blast radius if the Secret ever leaks, so do not skip this pass.

### Emergency rotation (suspected key compromise)

Skip the two-pass procedure. Generate a fresh single-key JWKS **without**
`--append`, update the Secret, and restart. Every previously issued JWT
(access / ID token) is immediately invalidated, because none of them verify
against the new key.

Signing-key rotation does **not** touch refresh tokens: they are opaque adapter
records validated by database lookup, not by the JWKS. An attacker holding a
stolen refresh token could otherwise keep minting fresh access tokens — signed
by the *new* key — straight through the rotation. So in a compromise scenario,
also revoke the stored grants:

```sql
-- Invalidate all refresh tokens (and, if you want a hard cutover, sessions).
DELETE FROM oidc_model WHERE model_name = 'RefreshToken';
```

Then restart. Expect all clients to re-authenticate.

> Refresh tokens are moot today — this service only exposes `client_credentials`,
> which issues no refresh token. This step matters once the interactive flows in
> AU-02 (#35) land, and the runbook is written to be correct for that.

## Rotating cookie signing keys

`OIDC_COOKIE_KEYS` is a comma-separated, ordered list. The **first** entry signs new cookies; the remaining entries are still accepted for verification. That gives cookie keys the same two-pass rotation shape:

1. Prepend a new secret, keeping the current one:
   `OIDC_COOKIE_KEYS=<new>,<current>`
2. Update the Secret and restart the API.
3. After the longest interactive session has expired, drop the trailing entry.

Cookie keys only matter once interactive login lands (AU-02, #35). With `client_credentials` alone, oidc-provider does not set session cookies, so rotating them has no visible effect.

## Notes and gotchas

- **Do not rotate by running `helm upgrade` with a new `oidcSigning.keys` value.** The chart's Secret template deliberately preserves existing key material when the value is empty, so an ordinary upgrade never silently rotates. Passing new keys through Helm replaces the whole JWKS in one step, dropping the old key and invalidating live tokens.
- **`helm template` and `--dry-run` cannot read the live Secret.** The template falls back to generating a random `OIDC_COOKIE_KEYS`, so rendered output will differ from what is deployed. Only trust in-cluster `helm upgrade` for this.
- **Restarts are required.** Nothing watches `OIDC_KEYS_PATH` for changes.
- **Never commit key material.** `oidc-keys.json` is gitignored; keep it that way.
