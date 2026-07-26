# ADR 0009: Chrome Web Store authoritative identity

- Status: accepted
- Date: 2026-07-25

## Context

The initial browser identity was derived from a locally generated public key
before the district Chrome Web Store publisher contained an item. Production
Atrium registered that provisional redirect and extension origin. During the
approved private-store submission, the publisher was verified to contain no
existing items, and Chrome Web Store rejected the first package because uploaded
manifests may not contain a `key` field.

Google's documented workflow makes the first accepted upload authoritative:
Chrome Web Store creates the item ID and public key, and development builds then
use that public key to reproduce the store extension origin.

## Decision

- The authoritative Chrome Web Store item ID is
  `eomlblaiglafndhplfhilmdcaofhkkbj`.
- Development, test, and unpacked builds include the public key returned by the
  district-owned item so their extension ID matches the store item.
- Chrome Web Store upload ZIPs omit the `key` field. Google injects the
  authoritative key while signing the CRX.
- `browser_extension` keeps its existing public OAuth client UUID, but
  production Atrium must replace the provisional callback/origin with:
  - `https://eomlblaiglafndhplfhilmdcaofhkkbj.chromiumapp.org/atrium`
  - `chrome-extension://eomlblaiglafndhplfhilmdcaofhkkbj`
- The native-host allowlist, managed policy, tests, acceptance probes,
  distribution verifiers, and runbooks use the store-assigned ID.

The provisional identifier
`jldnpmcpimhabiphcglkbgmbffpoocpo` must not be published or retained as an
accepted production callback after migration.

## Consequences

The first accepted `1.0.0` package is an unpublished bootstrap draft used only
to establish store identity. The final reviewed package must have a higher
version, match the authoritative ID in development builds, omit `key` in its
upload manifest, pass all local gates, and be uploaded to the existing private
item. Submission remains blocked until production Atrium accepts the new exact
callback and extension origin.
