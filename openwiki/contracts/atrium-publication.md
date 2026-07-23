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

## Required capabilities

- Authorization Code with S256 PKCE
- Immutable authored screenshot assets
- Permission-filtered collection discovery or a managed default
- Idempotent object, asset, and version writes
- Optimistic concurrency for broad rollout
- RFC 8252 native redirect support for macOS

Live endpoints and scopes are not inferred. The local HTTP mock uses only the
visibly non-production `/_mock/atrium-capture/v1` route.

## Durable phases

The outbox creates a private bodyless object, uploads only
`publishable_local` assets, creates a Markdown version using gateway-issued
asset references, and records the reader URL. Internal publication is a
separate explicit action. Every remote ID is persisted before the next phase.

Failure-after-commit tests interrupt every phase and prove retry produces one
object, one copy of each asset, and one version. No private screenshot host or
undocumented production route exists in this repository.

See [`docs/atrium-integration.md`](../../docs/atrium-integration.md).
