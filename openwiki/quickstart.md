---
type: Quickstart
title: Atrium Capture Codebase Overview
description: Browser-first workflow recorder and native macOS companion that create reviewed visual guides for Atrium.
tags: [quickstart, capture, browser-extension, macos, privacy]
---

# Atrium Capture

Atrium Capture records meaningful workflow actions, pairs them with screenshots,
supports explicit review and irreversible redaction, and prepares a durable
private Atrium draft. It is an independent MIT-licensed implementation.

## Current status

The Chrome extension and native macOS app build and pass their shared contract,
recovery, privacy, publication, and image-golden tests. Live production Atrium
authentication and private-draft publishing are accepted with synthetic data.
The district Chrome Web Store publisher owns the private browser item
`eomlblaiglafndhplfhilmdcaofhkkbj`; production Atrium must update its registrations
from the provisional callback/origin to the authoritative identity documented in
[ADR 0009](https://github.com/psd401/atrium-capture/blob/main/docs/adr/0009-chrome-web-store-authoritative-identity.md).
The remaining release gates are private PSD-only Chrome Web Store review/managed-ring
acceptance and district Developer ID/notarized Mac distribution.

## Repository map

| Path                                                    | Purpose                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`apps/browser-extension/`](../apps/browser-extension/) | WXT, React, TypeScript, Manifest V3 recorder/editor                    |
| [`apps/macos/`](../apps/macos/)                         | SwiftUI/AppKit, ScreenCaptureKit, Accessibility, and Core Graphics app |
| [`contracts/`](../contracts/)                           | Language-neutral JSON Schema source of truth                           |
| [`packages/capture-core/`](../packages/capture-core/)   | Platform-neutral capture state and normalized event rules              |
| [`packages/editor-model/`](../packages/editor-model/)   | Review, annotation, crop, ordering, and redaction commands             |
| [`packages/privacy/`](../packages/privacy/)             | Sensitive-field policy and capture decisions                           |
| [`packages/atrium-client/`](../packages/atrium-client/) | Capability-gated Atrium gateway and local mock boundary                |
| [`packages/test-fixtures/`](../packages/test-fixtures/) | Synthetic shared fixtures and browser test site                        |
| [`docs/`](../docs/)                                     | Architecture, runbooks, milestones, ADRs, and verification evidence    |

## Core invariants

1. Password values and ordinary typed values are never retained.
2. The service worker or native recorder persists state before acknowledging an event.
3. Only newly flattened, metadata-stripped derivatives can become publishable.
4. Raw screenshots never enter an Atrium outbox.
5. OAuth tokens remain in trusted browser/native contexts.
6. New Atrium objects are private drafts unless the author explicitly publishes internally.
7. Native messaging carries bounded semantic/control metadata, never screenshot bytes.

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm security:audit
pnpm build:mac
pnpm verify:pilot
```

The final command is intentionally fail-closed until the exact browser upload
has a matching signed PSD-only store receipt and the Mac app has a stable Apple
signature.

See [operations/development-and-verification.md](operations/development-and-verification.md)
for individual gates and environment requirements.

## Navigation

- [Architecture overview](architecture/overview.md)
- [Browser recorder](browser/recorder.md)
- [Browser review and redaction](browser/review-and-redaction.md)
- [Contracts and shared fixtures](contracts/contracts-and-fixtures.md)
- [Atrium publication boundary](contracts/atrium-publication.md)
- [Native recorder](macos/native-recorder.md)
- [Region capture and pins](macos/overlay-tools.md)
- [Privacy model](privacy/security-and-privacy.md)
- [Release gates](operations/release-gates.md)
