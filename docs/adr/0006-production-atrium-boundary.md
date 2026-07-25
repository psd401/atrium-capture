# ADR 0006: Production Atrium publishing boundary

- Status: accepted
- Date: 2026-07-24

## Context

AI Studio now documents and serves the Atrium v1 content, collection, version, immutable authored-asset, and publication APIs. Its OIDC discovery advertises Authorization Code, refresh tokens, S256 PKCE, public browser-extension/native application profiles, content scopes, and token revocation. Atrium Capture can therefore replace its unavailable gateway without inventing a route or screenshot host.

OAuth client records begin as deployment state. Once administrators register and
approve the two first-party applications, their generated public UUIDs are stable
application identifiers rather than credentials. Requiring each employee or
device policy to supply those identifiers would turn an administrator detail into
an avoidable end-user failure mode.

The authored-asset initiation route now accepts an idempotency key and returns
the same asset reservation with a refreshed upload request when that key is
replayed. Completion is idempotent once an asset is ready.

## Decision

- Both clients use only `https://aistudio.psd401.ai/api/v1` and endpoints returned by the same issuer's OIDC discovery.
- Administrators register two public clients with no secret:
  - `browser_extension` → `https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium`
  - `native` → `org.psd401.atrium-capture:/oauth/callback`
- Requested scopes are `openid profile offline_access content:read content:create content:update content:publish_internal`.
- Browser and native authorization requests include the Atrium issuer as the RFC
  8707 `resource` indicator, matching Atrium's resource-server token profile.
- Production builds bundle the approved browser and Mac public client UUIDs. No
  user configures OAuth. Strict Chrome managed policy, MDM preferences, and local
  environment variables may override the public UUIDs for an approved test
  environment; invalid policy still fails closed. Neither UUID is a credential.
- Browser tokens live in `chrome.storage.local` after it is restricted to trusted
  extension contexts. This supports unattended service-worker and browser
  restarts on managed devices; sign-out/revocation clears the record. Mac tokens
  live in Keychain. Refresh-token rotation is serialized; content scripts,
  native messages, diagnostics, and logs receive no token.
- Object creation is bodyless, tagged `atrium-capture`, explicitly private, and carries the immutable capture `sourceRef`. The client rejects a response that is not private or unexpectedly contains a current version.
- Browser source provenance retains only normalized HTTP(S) origins. Literal
  loopback, link-local, and private-network addresses (and `localhost`) are
  omitted: they disclose workstation topology, have no durable reader value, and
  can correctly trip production edge SSRF protections. Internal district DNS
  names remain eligible when source-origin retention policy permits them.
- Only flattened `publishable_local` image bytes enter the direct presigned S3
  upload. The S3 request uses the server-returned content type and its
  integrity-bound checksum. AWS may bind that checksum in the signed URL query
  or in `X-Amz-SignedHeaders`; the clients omit a byte-identical query/header
  duplicate because S3 rejects an extra unsigned `x-amz-*` header, and fail
  closed if the values disagree or do not encode the reviewed derivative's
  expected SHA-256. Each gateway independently recomputes SHA-256 from the
  exact flattened bytes before any network request and rejects a caller/digest
  mismatch. The Atrium bearer token never enters the S3 request. The
  upload URL must use HTTPS and an AWS S3 service hostname; a different AWS
  service hostname is rejected before image bytes are read.
- Markdown uses only canonical `::atrium-asset{...}` directives. Version creation uses `If-Match: "none"`; internal publication is a separate user action bound to the exact returned version ETag.
- Before reserving an asset, the gateway lists the object's assets and reuses a
  matching ready asset by deterministic filename, digest, byte length, MIME type,
  and dimensions. Pending reservations are replayed through the documented
  idempotent initiation route to obtain a fresh, short-lived upload request,
  re-uploaded, and completed. This recovers process termination before either the
  upload URL or completion receipt is durably recorded without creating a second
  asset row.

## Consequences

Private draft publication is production-accepted from both clients. Employees
only choose **Sign in to AI Studio** and complete the district login; client
registration and UUID distribution are not part of their workflow. Production
OIDC discovery and the unauthenticated content boundary are covered by
credential-free smoke commands.

The browser's token POST is a cross-origin request from the stable extension
origin `chrome-extension://jldnpmcpimhabiphcglkbgmbffpoocpo`; it cannot use the
HTTPS `chromiumapp.org` callback as its request origin and cannot suppress
Chrome's `Origin` header. Atrium must therefore allow that exact origin only for
the exact browser client. Wildcard CORS, a client-side proxy, a confidential
secret, or an alternate screenshot host would weaken the reviewed boundary and
are rejected. `pnpm smoke:atrium:browser-token` now proves production reaches
synthetic code validation and returns `invalid_grant` without authorization or
credentials. `pnpm smoke:atrium:browser-content` separately executes every
documented content route from the built extension worker; this is required
because a Node fetch cannot reproduce Chrome's native-function receiver rules.
The Mac `URLSession` exchange is not a browser CORS request.

Atrium's idempotent asset-initiation contract closes the former reservation
recovery gap: the stable per-asset key returns the same row with a replacement
upload request. The client does not work around storage failures with a private
host, guessed route, or unredacted upload.
