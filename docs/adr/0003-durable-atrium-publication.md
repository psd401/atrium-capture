# ADR 0003: Durable Atrium publication and capability boundary

- Status: accepted
- Date: 2026-07-22

## Context

Manifest V3 workers can stop between any two statements, and a network connection can fail after Atrium commits a request but before the client receives the response. Publication also crosses the privacy boundary: raw images must never be selected, new objects must remain private by default, and live Atrium routes cannot be inferred while required production contracts are absent.

The audited Atrium surface does not yet provide the complete production OAuth, immutable authored-asset, collection-discovery, and idempotent-write contract required by the client. Local implementation and recovery testing must continue without creating an unofficial image host or undocumented production API.

## Decision

- `AtriumGateway` is the only remote boundary. Its capabilities independently gate OAuth, collection discovery, immutable assets, idempotent writes, and internal publication.
- The production gateway remains fail-closed and contains no guessed route. The HTTP mock is explicitly synthetic and accepts only the versioned `/_mock/atrium-capture/v1` namespace.
- Authorization uses a public-client Authorization Code flow with S256 PKCE and Chrome's documented `identity.getRedirectURL`/`launchWebAuthFlow` boundary. No client secret is shipped, and token responses are accepted only in the trusted worker context. Live exchange endpoints and scopes remain unconfigured until Atrium publishes them.
- The outbox persists `creating_object`, each `uploading` asset state, `creating_version`, and `publishing_internal` before the corresponding remote call. Retries reuse deterministic idempotency keys derived from the durable job ID.
- The gateway accepts only `publishable_local` derivatives. Raw or merely redacted local assets cannot enter an upload plan, even when a managed retention policy keeps their bytes temporarily.
- Object creation requires `visibility: private`. A ready private draft and reader link are terminal for the default operation. Internal publication is a separate explicit command with its own idempotency key.
- Collection discovery supplies the picker. When discovery is unavailable, only a validated administrator-managed collection ID may replace it.
- `PublishJob.readerUrl` is an optional additive 1.0 contract field so legacy queued jobs continue to decode in TypeScript and Swift.

## Consequences

The same durable publisher can back IndexedDB and a future native store. Failure-after-commit injection can prove duplicate prevention without production credentials. The browser can ship local capture and review while clearly disabling live publication, but an authenticated Atrium pilot remains blocked on the named production contracts rather than being simulated by an unofficial route.
