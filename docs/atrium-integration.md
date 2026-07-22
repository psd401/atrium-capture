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

