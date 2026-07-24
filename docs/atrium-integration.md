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

| Client profile      | Exact redirect                                                    | Client ID delivery                       |
| ------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `browser_extension` | `https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium` | Chrome managed key `atriumOAuthClientId` |
| `native`            | `org.psd401.atrium-capture:/oauth/callback`                       | MDM preference `AtriumOAuthClientId`     |

The generated UUID is public configuration, not a secret. Never invent a client ID, add a confidential secret to either application, or commit tokens. The Mac preference `AtriumDefaultCollectionId` and browser `defaultCollectionId` are optional documented collection UUIDs. Local Mac testing may supply the same public values through `ATRIUM_CAPTURE_OAUTH_CLIENT_ID` and `ATRIUM_CAPTURE_DEFAULT_COLLECTION_ID`.

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
challenge and fails on registration errors such as `invalid_client`,
`invalid_redirect_uri`, or `invalid_scope`. It does not follow the request into
sign-in, exchange a code, receive a token, or print either client ID.

Unit/contract tests inject synthetic production-shaped responses and assert private/bodyless creation, source provenance, direct-upload headers, no S3 authorization header, canonical asset Markdown, ETag preconditions, refresh rotation, and deterministic asset recovery. The versioned `/_mock/atrium-capture/v1` server remains available for offline end-to-end outbox tests and never claims to be a production route.

Authenticated acceptance requires the two registered public client UUIDs and a district test account. Use only the repository's synthetic fixture and delete the resulting private draft after review according to district policy.
