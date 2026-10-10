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
| [`scripts/`](../scripts/)                               | Generators, validators, license gate, packaging, and release verifiers |

## Task routing

Start with the page in the middle column, then open the listed sources and run the
narrow check. Symbols are exported from the named file unless noted.

| Change area or intent                                  | Wiki page                                                                 | Entry points                                                                                                  | Key symbols                                                                  | Focused tests                                                                                                  | Minimal validation                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Browser recording, service-worker state, event receipts | [Browser recorder](browser/recorder.md)                                   | `apps/browser-extension/entrypoints/background.ts`, `apps/browser-extension/entrypoints/recorder.content.ts`  | `RecorderService`, `CaptureRepository`                                       | `apps/browser-extension/test/recorder-service.test.ts`, `apps/browser-extension/test/database-restart.test.ts` | `bunx vitest run apps/browser-extension/test/recorder-service.test.ts` |
| Managed browser policy (allowed origins, retention, budgets) | [Browser recorder](browser/recorder.md#managed-operation)        | `apps/browser-extension/src/managed-policy.ts`                                                                | `ManagedPolicyProvider`, `parseManagedPolicy`                                | `apps/browser-extension/test/managed-policy.test.ts`                                                           | `bunx vitest run apps/browser-extension/test/managed-policy.test.ts` |
| Capture state and normalized event rules               | [Architecture overview](architecture/overview.md)                         | `packages/capture-core/src/index.ts`                                                                          | `reduceCaptureEvent`, `transitionSession`                                    | `packages/capture-core/test/capture-core.test.ts`                                                              | `bunx vitest run packages/capture-core/test`                   |
| Review, annotation, crop, ordering, redaction commands | [Browser review and redaction](browser/review-and-redaction.md)          | `packages/editor-model/src/index.ts`, `apps/browser-extension/src/editor-service.ts`                          | `applyEditorCommand`, `canFinalizeReview`, `EditorService`                   | `packages/editor-model/test/editor-model.test.ts`, `apps/browser-extension/test/editor-service.test.ts`         | `bunx vitest run packages/editor-model/test`                   |
| Sensitive fields, site access, source URL retention    | [Privacy model](privacy/security-and-privacy.md)                          | `packages/privacy/src/index.ts`                                                                               | `classifyField`, `evaluateSiteAccess`, `retainBrowserLocation`              | `packages/privacy/test/privacy.test.ts`                                                                        | `bunx vitest run packages/privacy/test`                        |
| JSON Schema contracts and generated models             | [Contracts and shared fixtures](contracts/contracts-and-fixtures.md)     | `contracts/*.schema.json`, `scripts/generate-contracts.mjs`                                                   | generated `packages/contracts/src/generated/contracts.ts` (do not hand-edit) | `packages/contracts/test/contracts.test.ts`                                                                    | `bun run contracts:check`                                      |
| Atrium publication outbox and gateway                  | [Atrium publication boundary](contracts/atrium-publication.md)           | `packages/atrium-client/src/index.ts`, `packages/atrium-client/src/live-gateway.ts`, `apps/browser-extension/src/publication-service.ts` | `createPublishJob`, `DurablePublisher`, `ProductionAtriumGateway`, `BrowserPublicationService` | `packages/atrium-client/test/atrium-client.test.ts`, `packages/atrium-client/test/mock-http.test.ts`, `apps/browser-extension/test/publication-service.test.ts` | `bunx vitest run packages/atrium-client/test`                  |
| Browser/native bridge (metadata only)                  | [Contracts and shared fixtures](contracts/contracts-and-fixtures.md)     | `apps/browser-extension/src/native-bridge-service.ts`, `apps/macos/NativeMessaging/`                          | `NativeBridgeService`, `createBrowserNativeBridgeAdapter`                    | `apps/browser-extension/test/native-bridge-service.test.ts`                                                    | `bunx vitest run apps/browser-extension/test/native-bridge-service.test.ts` |
| Native recorder, durable journal, native publishing    | [Native recorder](macos/native-recorder.md)                               | `apps/macos/Sources/AtriumCaptureCore/NativeRecorder.swift`, `apps/macos/Sources/AtriumCaptureCore/NativePublishing.swift` | `NativeRecorder`, `DurableNativePublisher`                                   | `apps/macos/Tests/AtriumCaptureCoreTests/NativeRecorderTests.swift`, `.../NativePrivacyAndPublishingTests.swift` | `bun run swift:test` (narrow on macOS: `swift test --package-path apps/macos`) |
| Region capture, pins, shortcuts, overlays              | [Region capture and pins](macos/overlay-tools.md)                         | `apps/macos/Sources/AtriumCaptureMacPlatform/RegionSelectionOverlay.swift`, `apps/macos/Sources/AtriumCaptureCore/PinBoard.swift` | `PinBoard`, `RegionSelectionOverlay`                                         | `apps/macos/Tests/AtriumCaptureCoreTests/DisplayAndPinTests.swift`, `apps/macos/Tests/AtriumCaptureMacPlatformTests/ScreenCaptureGeometryTests.swift` | `bun run swift:test`                                           |
| Dependencies, workspace, license gate, CI wiring       | [Development and verification](operations/development-and-verification.md) | root `package.json`, `bun.lock`, `scripts/check-licenses.mjs`, `.github/workflows/ci.yml`, `.github/workflows/psd-ci.yml`, `.github/workflows/security-scan.yml`, `.gitleaksignore`, `.github/workflows/claude-code-review.yml`, `.github/workflows/openwiki-update.yml`, `.github/dependabot.yml` | `licenses:check`, `security:audit`, `overrides`, `trustedDependencies`       | `scripts/check-licenses.test.ts`                                                                               | `bunx vitest run scripts/check-licenses.test.ts`               |
| Release artifacts and signed-distribution gates        | [Release gates](operations/release-gates.md)                              | `scripts/verify-pilot-artifacts.mjs`, `scripts/verify-browser-package.mjs`, `scripts/verify-macos-package.mjs` | `verify:pilot`, `verify:mac-package`                                         | none (verifiers are the check)                                                                                 | `bun run verify:pilot` (expected to fail until external receipts exist) |

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
bun install --frozen-lockfile
bun run check
bun run security:audit
bun run build:mac
bun run verify:pilot
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
- [Development and verification](operations/development-and-verification.md)
- [Release gates](operations/release-gates.md)

## Backlog

- Firefox target is out of scope for v1. The `fx-runner` override in the root
  `package.json` and `packages/fx-runner-disabled/README.md` document the deferral;
  it stays until an upstream advisory has a patched path.
