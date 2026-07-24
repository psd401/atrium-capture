---
type: Architecture
title: Atrium Capture Architecture
description: Platform-neutral contracts connect separate browser and native implementations without sharing platform-specific runtime code.
tags: [architecture, service-worker, swift, durability, boundaries]
---

# Atrium Capture Architecture

The repository is a browser-first monorepo with a native Swift companion. JSON
Schemas and synthetic fixtures define the shared boundary. Browser DOM,
IndexedDB, Chrome APIs, ScreenCaptureKit, Accessibility, AppKit, and Keychain
remain in platform-specific adapters.

## Browser flow

```text
page event
  -> value-free content-script observation
  -> schema validation in the service worker
  -> serialized state transition and screenshot capture
  -> atomic IndexedDB persistence and acknowledgement
  -> side-panel review
  -> flattened publishable pixels
  -> durable Atrium outbox
```

The Manifest V3 service worker owns recording and publication state. Content
scripts receive neither OAuth credentials nor generic privileged RPC access.
Receipts make replay after worker suspension idempotent.

## Native flow

```text
Accessibility semantics + ScreenCaptureKit pixels
  -> serialized native recorder and durable journal
  -> CaptureSession v1
  -> Swift review/editor and Core Graphics renderer
  -> durable filesystem outbox
  -> native Atrium gateway
```

SwiftUI owns ordinary app UI. AppKit owns overlays, pins, global shortcuts, and
Space/full-screen window behavior. Keychain stores native credentials.

## Publication phases

Each `PublishJob` persists stable idempotency keys and remote IDs while creating
a private object, uploading publishable assets, creating a Markdown version,
and optionally publishing internally after a separate explicit command.
Object/version/publication retries resume from durable idempotent state. Asset
retries recover deterministic metadata before reservation; ADR 0006 isolates
the server's remaining non-idempotent initiation interval.

## Key decisions

- [`docs/adr/0001-platform-identifiers-and-support.md`](../../docs/adr/0001-platform-identifiers-and-support.md)
- [`docs/adr/0002-flattening-and-raw-retention.md`](../../docs/adr/0002-flattening-and-raw-retention.md)
- [`docs/adr/0003-durable-atrium-publication.md`](../../docs/adr/0003-durable-atrium-publication.md)
- [`docs/adr/0004-native-runtime-and-overlay-boundaries.md`](../../docs/adr/0004-native-runtime-and-overlay-boundaries.md)
- [`docs/adr/0005-atrium-aligned-visual-language.md`](../../docs/adr/0005-atrium-aligned-visual-language.md) — cross-platform presentation tokens that feel at home beside Atrium without bundling assets
- [`docs/adr/0006-production-atrium-boundary.md`](../../docs/adr/0006-production-atrium-boundary.md)
