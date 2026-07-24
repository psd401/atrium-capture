# Browser managed policy

Atrium Capture declares `public/managed-storage-schema.json` through the Manifest V3 `storage.managed_schema` key. Chrome validates administrator-provided values before exposing them through its read-only managed storage area; the worker performs a second strict validation and fails closed if storage is unreadable, a version is unsupported, or an unexpected key/value reaches the boundary.

Chrome's current managed-storage documentation is the platform source: <https://developer.chrome.com/docs/extensions/reference/manifest/storage>. Loaded policy is visible to administrators at `chrome://policy`. The worker restricts the managed storage area to `TRUSTED_CONTEXTS`, so page content scripts cannot read district configuration.

## Version 1 keys

| Key                   | Type / bounds                                    | Unmanaged default      | Effect                                                                                 |
| --------------------- | ------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------- |
| `schemaVersion`       | integer `1`                                      | not configured         | Required whenever any managed key is present.                                          |
| `allowedOrigins`      | up to 1,000 HTTP(S) origins or `*.domain` values | all HTTP(S) origins    | When present, recording is active only on matching origins. An empty list disables it. |
| `deniedOrigins`       | up to 1,000 HTTP(S) origins or `*.domain` values | empty                  | Evaluated before the allow list.                                                       |
| `sourceUrlRetention`  | `none`, `origin`, or `full`                      | `origin`               | `full` still stores only origin and pathname—never query or fragment.                  |
| `rawImageRetention`   | `delete_after_flatten` or `delete_after_submit`  | `delete_after_flatten` | Raw bytes never enter the outbox; retained bytes are deleted after draft success.      |
| `atriumOAuthClientId` | UUID                                             | none                   | Public Atrium `browser_extension` client ID; absence disables live sign-in.            |
| `defaultCollectionId` | UUID                                             | none                   | Replaces collection discovery only when live discovery is unavailable.                 |
| `maxStorageBytes`     | 16 MiB through 4 GiB                             | 512 MiB                | Internal image budget, even though Chrome grants `unlimitedStorage`.                   |
| `maxSessionSteps`     | 10 through 10,000                                | 1,000                  | Pauses recording before another step would exceed the limit.                           |

The synthetic example at `apps/browser-extension/policy/example-managed-policy.json` contains no district identifiers and is safe for local validation. Administrators must substitute approved origins, the Atrium-issued public client UUID, and any documented default collection UUID.

## Enforcement behavior

- Invalid configured policy disables capture, uses `sourceUrlRetention: none`, exposes no configured values to the page, and produces a content-free diagnostic code.
- A policy update broadcasts a refresh to every content script. New allow/deny and retention restrictions apply during an active recording; retention can become stricter but never looser within the session.
- The side panel cannot select raw retention or bypass a site rule. Finalization reads policy again in the worker and chooses the stricter of the session and current raw-retention settings.
- Storage exhaustion pauses before oversized bytes are committed. Already acknowledged events, images, and receipts remain recoverable.

## Deployment

Use Chrome Browser Cloud Management or the district's existing MDM to install the signed extension and publish its extension-specific managed keys. Chrome Enterprise documents force-install/update behavior under `ExtensionSettings`: <https://chromeenterprise.google/policies/extension-settings/>. Do not host or deploy an unsigned/private update endpoint from this repository.

Before a ring receives the policy:

1. Confirm the installed extension ID is `jldnpmcpimhabiphcglkbgmbffpoocpo`.
2. Validate the configuration against the packaged `managed-storage-schema.json` and the bounds above.
3. Refresh `chrome://policy` and confirm the keys have no validation errors.
4. Confirm the OAuth client is a public `browser_extension` profile with the exact immutable redirect from ADR 0001 and only the approved scopes.
5. Open Support diagnostics and confirm `Policy: valid`, the expected retention modes, and the intended origin counts. Diagnostics never reveal the client ID or token.
6. Test one allowed origin and one denied origin with synthetic content before authorizing real use.
