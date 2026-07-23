# Atrium integration

Audit baseline: `psd401/aistudio` `dev` commit `ba2cc4cae06fd49e5954d0419a407c21174e954c` (2026-07-22).

## Existing usable surface

- OAuth/OIDC Authorization Code + PKCE registration and endpoints.
- Content scopes: read, create, update, delete, publish internal/public, and delegate.
- Create/list/get/update/delete content objects.
- List/create immutable content versions.
- Set visibility and publish/unpublish destinations.
- Private-by-default content behavior and approval gating for public publication.

## Required Atrium work

Browser publication depends on:

1. Production-capable OAuth token signing/validation.
2. Immutable authored content-asset upload/render APIs.
3. Permission-filtered collection discovery for a reliable picker (or a temporary managed default collection).

District beta should also require idempotent content writes and optimistic concurrency. Version-source reads enable cross-device reopen/conflict resolution. RFC 8252 redirect support is required before the Mac companion authenticates. Structured capture provenance is a useful follow-up.

Do not implement a private screenshot backend in this repository. Until the asset API exists, keep publishing behind an `AtriumGateway` mock/feature gate while the complete local recording and review loop is developed.

## Implemented local boundary

The client now contains the production-neutral `AtriumGateway`, a durable phase machine, browser IndexedDB outbox, collection-discovery/managed-default selection, Authorization Code + S256 PKCE primitives, and trusted Chrome Identity flow adapter. It creates private objects, selects only flattened `publishable_local` assets, creates Markdown through gateway-issued asset references, persists a reader link, and requires a separate explicit command for internal publication.

No live URL or scope is present. The synthetic in-memory and HTTP gateways use deterministic UUIDs and the visibly non-production `/_mock/atrium-capture/v1` route. Failure injection occurs after the mock commits each object, asset, version, and internal-publication operation; stable keys prove retries do not duplicate remote state. See [ADR 0003](adr/0003-durable-atrium-publication.md).

As of 2026-07-22, a public-web search found no authoritative Atrium API publication beyond the repository audit baseline above. The live capability therefore remains disabled. Chrome's current Identity API documentation confirms that `identity` permission, `getRedirectURL`, and interactive `launchWebAuthFlow` are the supported extension boundary: <https://developer.chrome.com/docs/extensions/reference/api/identity>.

## Client registration plan

Atrium Capture uses public OAuth clients with Authorization Code and S256 PKCE; neither client ships a secret. The browser registration uses the immutable extension redirect in [ADR 0001](adr/0001-platform-identifiers-and-support.md). The Mac registration uses the ADR's claimed HTTPS/custom-scheme callback only after Atrium documents RFC 8252 native redirect support. Requested scopes will be selected from Atrium's current discovery and published API documentation at integration time rather than hard-coded from an inferred or private route.

OAuth availability, immutable asset upload, collection discovery, idempotent writes, and optimistic concurrency are independent `AtriumGateway` capabilities. A missing capability disables only its live UI path. Local capture/review and the versioned mock gateway remain available, and a managed default collection may replace discovery only when policy supplies a valid identifier.
