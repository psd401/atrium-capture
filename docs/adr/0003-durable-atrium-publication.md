# ADR 0003: Durable Atrium publication and capability boundary

- Status: accepted
- Date: 2026-07-22

## Context

Manifest V3 workers can stop between any two statements, and a network connection can fail after Atrium commits a request but before the client receives the response. Publication also crosses the privacy boundary: raw images must never be selected, new objects must remain private by default, and live Atrium routes cannot be inferred while required production contracts are absent.

At the time of this decision, the audited Atrium surface did not provide the complete production OAuth, immutable authored-asset, collection-discovery, and idempotent-write contract required by the client. Those routes are now documented and implemented by [ADR 0006](0006-production-atrium-boundary.md); the persistence and privacy decisions below remain in force.

## Decision

- `AtriumGateway` is the only remote boundary. Its capabilities independently gate OAuth, collection discovery, content metadata updates, immutable assets, idempotent writes, and internal publication.
- A production gateway may use only current documented routes. The HTTP mock remains explicitly synthetic and accepts only the versioned `/_mock/atrium-capture/v1` namespace.
- Authorization uses public-client Authorization Code with S256 PKCE, the Atrium issuer as the RFC 8707 resource indicator, and Chrome's documented `identity.getRedirectURL`/`launchWebAuthFlow` boundary. No client secret is shipped, and token responses are accepted only in the trusted worker context.
- The outbox persists `creating_object`, each `uploading` asset state, `creating_version`, and `publishing_internal` before the corresponding remote call. Retries reuse deterministic idempotency keys derived from the durable job ID.
- The gateway accepts only `publishable_local` derivatives. Raw or merely redacted local assets cannot enter an upload plan, even when a managed retention policy keeps their bytes temporarily.
- Object creation requires `visibility: private`. A ready private draft and reader link are terminal for the default operation. Internal publication is a separate explicit command with its own idempotency key.
- Collection discovery supplies the picker. When discovery is unavailable, only a validated administrator-managed collection ID may replace it.
- `PublishJob.readerUrl` is an optional additive 1.0 contract field so legacy queued jobs continue to decode in TypeScript and Swift.
- `PublishJob.createTitle` freezes the idempotent create body, while `remoteTitle` records the most recent title confirmed by Atrium. Both are optional additive 1.0 fields; post-create reconciliation follows [ADR 0007](0007-active-guides-and-title-synchronization.md).

## Consequences

The same durable phase model backs IndexedDB and the native filesystem store. Failure-after-commit injection proves duplicate prevention without production credentials. Production integration details, the exact browser-origin policy, real extension-worker smoke, and the remaining asset-reservation limitation are recorded in ADR 0006 rather than weakening this outbox.
