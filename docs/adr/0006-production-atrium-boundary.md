# ADR 0006: Production Atrium publishing boundary

- Status: accepted
- Date: 2026-07-24

## Context

AI Studio now documents and serves the Atrium v1 content, collection, version, immutable authored-asset, and publication APIs. Its OIDC discovery advertises Authorization Code, refresh tokens, S256 PKCE, public browser-extension/native application profiles, content scopes, and token revocation. Atrium Capture can therefore replace its unavailable gateway without inventing a route or screenshot host.

OAuth client records are still deployment state. The server generates a random public client UUID for each application profile; that UUID cannot be inferred from the extension ID or bundle ID.

The authored-asset initiation route does not accept an idempotency key and does not expose a uniqueness constraint over object, filename, and digest. Completion is idempotent once an asset is ready.

## Decision

- Both clients use only `https://aistudio.psd401.ai/api/v1` and endpoints returned by the same issuer's OIDC discovery.
- Administrators register two public clients with no secret:
  - `browser_extension` → `https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium`
  - `native` → `org.psd401.atrium-capture:/oauth/callback`
- Requested scopes are `openid profile offline_access content:read content:create content:update content:publish_internal`.
- The browser client UUID is supplied through strict Chrome managed policy. The Mac client UUID and optional default collection UUID are public MDM preferences, with environment overrides only for local testing. Neither UUID is a credential.
- Browser tokens live in `chrome.storage.session` after it is restricted to trusted contexts. Mac tokens live in Keychain. Refresh-token rotation is serialized; content scripts, native messages, diagnostics, and logs receive no token.
- Object creation is bodyless, tagged `atrium-capture`, explicitly private, and carries the immutable capture `sourceRef`. The client rejects a response that is not private or unexpectedly contains a current version.
- Only flattened `publishable_local` image bytes enter the direct presigned S3 upload. The S3 request receives exactly the server-returned content type/checksum headers and never receives the Atrium bearer token.
- Markdown uses only canonical `::atrium-asset{...}` directives. Version creation uses `If-Match: "none"`; internal publication is a separate user action bound to the exact returned version ETag.
- Before reserving an asset, the gateway lists the object's assets and reuses a matching deterministic filename, digest, byte length, MIME type, and dimensions. It also completes a matching pending reservation to recover an ambiguous upload/completion response.

## Consequences

Private draft publication is locally complete and ready as soon as the two public OAuth client IDs are registered and distributed. Production OIDC discovery and the unauthenticated content boundary are covered by a credential-free smoke command.

One server-side durability gap remains: if the process dies after Atrium commits asset initiation but before the client receives and durably records the one-time presigned URL, the client cannot upload to that reservation. While it is unexpired, a deterministic retry fails safely rather than creating another row; after expiry, a retry may create a replacement reservation and leave the expired row for server lifecycle cleanup. Strict no-duplicate-asset-row recovery for that exact interval requires Atrium to make initiation idempotent or return a replacement upload request for a deterministic reservation. The client does not work around this with a private host, guessed route, or unredacted upload.
