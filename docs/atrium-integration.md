# Atrium integration

Audit baseline: `psd401/aistudio` `dev` commit `d4d6fb87` (2026-07-24), its current `docs/API/v1/openapi.yaml`, `docs/API/v1/context-graph.md`, and `docs/features/oauth-provider.md`. The content/OAuth contract is unchanged from the initially audited `264f718`. The client never imports or copies AI Studio source.

## Production contract

Atrium Capture uses the documented production origin `https://aistudio.psd401.ai`:

| Operation                      | Contract                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| OIDC discovery                 | `GET /.well-known/openid-configuration`                                                                          |
| Authorization/token/revocation | `/api/oauth/auth`, `/api/oauth/token`, `/api/oauth/revocation`                                                   |
| Collection picker              | `GET /api/v1/content/collections?shape=flat`; show only `selectableForCreate`                                    |
| Private bodyless draft         | `POST /api/v1/content` with `visibility.level: private`, `sourceRef`, and an idempotency key                     |
| Title update                   | `PATCH /api/v1/content/{id}` with `{ "title": "..." }` and the `content:update` scope                            |
| Asset recovery/reservation     | `GET/POST /api/v1/content/{id}/assets`                                                                           |
| Asset bytes                    | Direct `PUT` to the server-issued S3 URL with only its exact content type/checksum headers                       |
| Asset completion               | `POST /api/v1/content/{id}/assets/{assetId}/complete`                                                            |
| Markdown snapshot              | `POST /api/v1/content/{id}/versions` with an idempotency key and `If-Match: "none"`                              |
| Internal publication           | `POST /api/v1/content/{id}/publish` with `destination: intranet`, an idempotency key, and the exact version ETag |

The production gateways validate bounded response shapes and UUIDs. They upload only flattened `publishable_local` derivatives and insert only canonical Atrium asset directives. Raw bytes are never selected, a storage URL is never persisted in Markdown, and the bearer token is never sent to S3.

Every object includes:

```json
{
  "type": "capture",
  "provider": "atrium-capture",
  "externalId": "<durable session UUID>",
  "clientSurface": "browser | mac",
  "clientVersion": "<application version>",
  "capturedAt": "<ISO-8601>",
  "sourceOrigins": ["<browser origins only when policy permits>"]
}
```

The Mac client omits `sourceOrigins`; Accessibility application/window details never become web provenance. Browser origins are normalized to HTTP(S) origins and omitted when policy says `none`.

## OAuth registration and configuration

Create two public clients at Atrium's administrator OAuth client screen. Select no client secret, require S256 PKCE, and allow:

`openid profile offline_access content:read content:create content:update content:publish_internal`

| Client profile      | Exact redirect                                                    | Production configuration                      |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| `browser_extension` | `https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium` | Approved public UUID bundled in the extension |
| `native`            | `org.psd401.atrium-capture:/oauth/callback`                       | Approved public UUID bundled in the Mac app   |

The generated UUID is public application configuration, not a secret. Production
builds bundle it so no employee configures OAuth. The Chrome managed key
`atriumOAuthClientId`, Mac preference `AtriumOAuthClientId`, and local
`ATRIUM_CAPTURE_OAUTH_CLIENT_ID` variable are optional administrator/developer
overrides for an approved test client. Never invent a client ID, add a
confidential secret to either application, or commit tokens. The Mac preference
`AtriumDefaultCollectionId` and browser `defaultCollectionId` remain optional
documented collection UUIDs.

These are district-owned first-party clients. The end-user authorization flow is:

1. select **Sign in to AI Studio** in Atrium Capture;
2. complete the normal district AI Studio login if no session exists; and
3. return automatically to Atrium Capture.

It must not expose client registration, raw redirect responses, manual UUID
settings, or an additional consent decision. Atrium must still validate the exact
registered redirect, S256 PKCE challenge, and pre-approved scope allowlist. Login
may be skipped only when a valid AI Studio session already exists.

### Current production acceptance status

As of 2026-07-24, production accepts both exact redirects and all seven scopes,
returns real authorization redirects, performs district login, skips consent
only for the two explicitly trusted first-party records, and accepts token
exchange from the exact stable extension origin. Browser sign-in reaches the
registered callback, exchanges the code, and reports `Connected to Atrium`.

The first authenticated private-draft attempt exposed a client-only Chrome
runtime defect: the production gateway stored native `fetch` as an object
property and invoked it with the gateway as its receiver. Chrome rejects that
illegal invocation before network I/O, while Node's injected contract transport
does not. The gateway now calls a receiver-neutral wrapper, the regression test
requires an unbound transport call, and
`pnpm smoke:atrium:browser-content` proves the built extension worker reaches
all eight documented content routes. API requests have a 30-second deadline and
direct asset uploads have a 120-second deadline so a durable outbox phase cannot
wait indefinitely.

The production native flow has completed district login, returned through the
registered callback, exchanged the code, stored the token set in Keychain, and
reported `Connected to Atrium` in the app. A regression test invokes the
AuthenticationServices completion from a background queue so the callback
bridge cannot accidentally inherit `@MainActor` and crash on Safari's XPC
queue.

Server acceptance must continue to cover:

- signed-out first-party user → normal district login → app callback, no consent;
- signed-in first-party user → app callback, no consent;
- exact browser client plus exact `chrome-extension://` origin → token request
  reaches code validation;
- another origin or client/origin mismatch → fail-closed rejection;
- unknown/untrusted client → normal consent or fail-closed rejection;
- callback mismatch, missing S256, or unregistered scope → fail-closed error; and
- authorization start → actual HTTP 3xx response, never a 200 redirect body.

The browser keeps the token set in trusted-only `chrome.storage.session`, which survives MV3 service-worker stops but deliberately requires sign-in after a full browser exit. The native app stores tokens in Keychain. Both rotate public-client refresh tokens and revoke/clear them on sign-out.

## Recovery behavior

Object, version, and internal-publication retries reuse durable idempotency keys. Asset filenames are deterministic from the local asset UUID. Before initiating an upload, clients list existing assets and reuse a matching ready row or complete a matching pending row. An ambiguous S3 response is followed by completion, so a committed upload is recoverable without another reservation.

The title captured in an object-create request is frozen in the outbox before
that request runs. A later rename updates local desired state immediately. After
the object ID is known, the client reconciles the desired title through the
documented metadata `PATCH`, including for ready drafts and completed internal
publications. This prevents an ambiguous create retry from changing its request
body while still allowing users to correct titles at any time.

Atrium asset initiation currently has no `Idempotency-Key`. If the server commits a reservation but the response containing its presigned URL is lost, the client safely refuses a second reservation until the first expires. After expiry it can continue with a new reservation, but the expired row remains until server cleanup. [ADR 0006](adr/0006-production-atrium-boundary.md) records why strict row-level deduplication for this one interval requires a server contract change.

## Verification

Credential-free production boundary check:

```sh
pnpm smoke:atrium
```

It verifies the exact issuer/endpoints, S256, required scopes, and the structured unauthenticated `401` from collection discovery. It does not send capture content or credentials.

The production public IDs are bundled. To verify that Atrium accepts every
required OIDC and content scope without signing in:

```sh
pnpm smoke:atrium
```

This check starts each authorization request with a synthetic PKCE
challenge and requires a real HTTP 3xx response with a `Location` header. It
fails on non-redirect responses and registration errors such as `invalid_client`,
`invalid_redirect_uri`, or `invalid_scope`. It does not follow the request into
sign-in, exchange a code, receive a token, or print either client ID. Both
documented environment variables may override the bundled IDs together for a
separately approved test-client pair.

Probe the browser-specific token boundary without credentials:

```sh
pnpm smoke:atrium:browser-token
```

It submits a deliberately invalid synthetic code with the exact extension
origin. A correct boundary reaches code validation and returns `invalid_grant`;
production now passes. The script never requests authorization, receives a
token, or prints the server's raw description.

Probe the actual built service worker without credentials:

```sh
pnpm smoke:atrium:browser-content
```

It exercises collection discovery, object creation, title update, asset
recovery/initiation/completion, version creation, and internal publication with
a synthetic invalid token. Each must reach Atrium and fail closed as
`401 INVALID_TOKEN`.

Unit/contract tests inject synthetic production-shaped responses and assert private/bodyless creation, source provenance, direct-upload headers, no S3 authorization header, canonical asset Markdown, ETag preconditions, refresh rotation, and deterministic asset recovery. The versioned `/_mock/atrium-capture/v1` server remains available for offline end-to-end outbox tests and never claims to be a production route.

Authenticated acceptance requires the two registered public client UUIDs and a
district test account. Native sign-in and browser sign-in are verified. The
browser runner uses only the committed synthetic fixture, reports bounded
outbox/network diagnostics, and can retain an isolated profile after a failure
when `ATRIUM_CAPTURE_ACCEPTANCE_PROFILE_DIR` is explicitly set. Final
private-draft/image/version acceptance remains operator-attended; delete
resulting synthetic private drafts after review according to district policy.
