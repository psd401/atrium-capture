# Atrium integration

Audit baseline: `psd401/aistudio` `dev` commit `0dd5cbc` (2026-07-24), its current `docs/API/v1/openapi.yaml`, `docs/API/v1/context-graph.md`, and `docs/features/oauth-provider.md`. The content/OAuth contract is unchanged from the initially audited `264f718`. The client never imports or copies AI Studio source.

## Production contract

Atrium Capture uses the documented production origin `https://aistudio.psd401.ai`:

| Operation                      | Contract                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| OIDC discovery                 | `GET /.well-known/openid-configuration`                                                                          |
| Authorization/token/revocation | `/api/oauth/auth`, `/api/oauth/token`, `/api/oauth/revocation`                                                   |
| Collection picker              | `GET /api/v1/content/collections?shape=flat`; show only `selectableForCreate`                                    |
| Private bodyless draft         | `POST /api/v1/content` with `visibility.level: private`, `sourceRef`, and an idempotency key                     |
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

### Current production acceptance blockers

As of 2026-07-24, both registered profiles accept the exact redirect and seven
required scopes, but the authorization route returns HTTP 200 with a `Location`
header and a textual “Redirecting…” body. Browsers correctly render that body
instead of following it. The Atrium Next/Node response adapter must forward the
actual provider status (including 303); an initialized fallback 200 must not
override `ServerResponse.statusCode`.

After that redirect is fixed, Atrium must distinguish the two administrator-owned
first-party clients from third-party OAuth clients. It should create/reuse a
grant containing only the intersection of requested scopes and the client's
registered allowlist after the district user is authenticated. This should
satisfy the consent checks for those exact client records while leaving the
provider's login checks intact. Do not globally remove consent, trust a client by
display name/redirect pattern, or grant a scope absent from its registration.

Server acceptance must cover:

- signed-out first-party user → normal district login → app callback, no consent;
- signed-in first-party user → app callback, no consent;
- unknown/untrusted client → normal consent or fail-closed rejection;
- callback mismatch, missing S256, or unregistered scope → fail-closed error; and
- authorization start → actual HTTP 3xx response, never a 200 redirect body.

The browser keeps the token set in trusted-only `chrome.storage.session`, which survives MV3 service-worker stops but deliberately requires sign-in after a full browser exit. The native app stores tokens in Keychain. Both rotate public-client refresh tokens and revoke/clear them on sign-out.

## Recovery behavior

Object, version, and internal-publication retries reuse durable idempotency keys. Asset filenames are deterministic from the local asset UUID. Before initiating an upload, clients list existing assets and reuse a matching ready row or complete a matching pending row. An ambiguous S3 response is followed by completion, so a committed upload is recoverable without another reservation.

Atrium asset initiation currently has no `Idempotency-Key`. If the server commits a reservation but the response containing its presigned URL is lost, the client safely refuses a second reservation until the first expires. After expiry it can continue with a new reservation, but the expired row remains until server cleanup. [ADR 0006](adr/0006-production-atrium-boundary.md) records why strict row-level deduplication for this one interval requires a server contract change.

## Verification

Credential-free production boundary check:

```sh
pnpm smoke:atrium
```

It verifies the exact issuer/endpoints, S256, required scopes, and the structured unauthenticated `401` from collection discovery. It does not send capture content or credentials.

After the two public clients are registered, verify that Atrium accepted every
required OIDC and content scope without signing in or storing either public ID:

```sh
ATRIUM_CAPTURE_BROWSER_OAUTH_CLIENT_ID=<public-browser-uuid> \
ATRIUM_CAPTURE_MAC_OAUTH_CLIENT_ID=<public-native-uuid> \
pnpm smoke:atrium
```

This optional mode starts each authorization request with a synthetic PKCE
challenge and requires a real HTTP 3xx response with a `Location` header. It
fails on non-redirect responses and registration errors such as `invalid_client`,
`invalid_redirect_uri`, or `invalid_scope`. It does not follow the request into
sign-in, exchange a code, receive a token, or print either client ID.

Unit/contract tests inject synthetic production-shaped responses and assert private/bodyless creation, source provenance, direct-upload headers, no S3 authorization header, canonical asset Markdown, ETag preconditions, refresh rotation, and deterministic asset recovery. The versioned `/_mock/atrium-capture/v1` server remains available for offline end-to-end outbox tests and never claims to be a production route.

Authenticated acceptance requires the two registered public client UUIDs and a district test account. Use only the repository's synthetic fixture and delete the resulting private draft after review according to district policy.
