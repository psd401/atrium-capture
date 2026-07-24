---
type: Integration
title: Atrium Publication Boundary
description: Browser and native clients share a capability-gated gateway contract and durable private-by-default publication algorithm.
tags: [atrium, oauth, pkce, outbox, idempotency]
---

# Atrium Publication Boundary

The production API is isolated behind small browser and native `AtriumGateway`
interfaces. Capture and review remain testable when a live capability is
unavailable.

## Production capabilities

- Authorization Code with S256 PKCE
- Immutable authored screenshot assets
- Permission-filtered collection discovery or a managed default
- Idempotent object/version/publication writes
- ETag concurrency
- Browser-extension and RFC 8252-style native redirects

The clients use the documented AI Studio v1/OIDC routes and bundle the approved
non-secret production public client UUIDs. Managed configuration can override a
UUID only for an approved test client. The local HTTP mock still uses only the
visibly non-production `/_mock/atrium-capture/v1` route.

## Durable phases

The outbox creates a private bodyless object, uploads only
`publishable_local` assets, creates a Markdown version using gateway-issued
asset references, and records the reader URL. Internal publication is a
separate explicit action. Every remote ID is persisted before the next phase.

Failure-after-commit tests interrupt every idempotent phase and prove retry
produces one object, one copy of each completed asset, and one version. Asset
reservation itself is not idempotent; deterministic lookup/completion recovers
later failures, while an initiation response lost before its presigned URL is
received remains the external limitation in ADR 0006. No private screenshot
host or undocumented production route exists.

See [`docs/atrium-integration.md`](../../docs/atrium-integration.md) and
[`docs/adr/0006-production-atrium-boundary.md`](../../docs/adr/0006-production-atrium-boundary.md).
