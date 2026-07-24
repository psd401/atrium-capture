# Architecture

## Decision

Build Atrium Capture as a greenfield, browser-first monorepo with language-neutral contracts. The Chrome extension ships first. A native Swift Mac app follows without changing the capture or publication model.

## Browser runtime

```text
page events
  -> content script (semantic observation only)
  -> validated message
  -> service worker (state machine + screenshot + persistence)
  -> IndexedDB (session, images, durable publish outbox)
  -> side panel/review editor
  -> flattened publishable images
  -> AtriumGateway
  -> Atrium private draft / internal publication
```

The content script never receives OAuth tokens and cannot publish. The service worker persists before acknowledging events because Manifest V3 may suspend it between events. Screenshot requests are serialized and low-value events are merged.

## Mac runtime

```text
ScreenCaptureKit + Accessibility events
  -> native platform adapter
  -> synchronous recorder journal + serialized frame queue
  -> CaptureSession v1
  -> Swift editor using the shared command model
  -> flattened publishable images
  -> durable native outbox
  -> actor-serialized native AtriumGateway + Keychain-backed OAuth
```

SwiftUI owns ordinary application UI. AppKit owns floating windows, always-on-top pins, click-through behavior, and global shortcuts. Core Graphics renders publishable images.

The Swift package keeps generated contracts, platform-neutral recovery/publication logic, and Apple adapters in separate targets. The app persists event receipts with the session before acknowledging an observed action. A task-tail queue prevents actor reentrancy from overlapping ScreenCaptureKit calls. Quartz top-left global coordinates remain canonical until the AppKit adapter converts a window frame.

## Cross-platform boundary

The browser and Mac applications share:

- JSON Schemas and generated models.
- Normalized action semantics and migration rules.
- Annotation/redaction command shapes.
- Markdown generation rules.
- Atrium OpenAPI contracts and error semantics.
- Synthetic golden fixtures.

They do not attempt to share browser Canvas, IndexedDB, Chrome APIs, AppKit, Accessibility objects, ScreenCaptureKit frames, or Keychain implementations.

## Optional native messaging

The Mac app may register a Chrome native messaging host after the browser product ships. The bridge is for control and DOM semantic enrichment only. Images remain on the platform that captured them and upload directly to Atrium. This avoids Chrome's native-message size ceiling and keeps a single owner for each local asset.

The bridge is implemented as an optional permission. The user-facing side panel requests `nativeMessaging`; the service worker sends a strict event subset after recorder persistence, and the Swift host validates a 64 KiB application limit plus prohibited image/token fields. Installation is a separate operator action.

## Atrium publication transaction

The durable `PublishJob` advances through these resumable phases:

1. Create a private, bodyless Atrium object with an idempotency key.
2. Upload only publishable screenshot assets.
3. Create the Markdown version referencing immutable Atrium asset IDs.
4. Leave the result as a private draft by default.
5. If the user explicitly selected internal publication, publish to the intranet destination.

Every phase persists its remote IDs before continuing. Object, version, and publication retries reuse the same idempotency keys. Asset retries first recover by deterministic filename, digest, byte length, MIME type, and dimensions and never select a raw original. Atrium's non-idempotent reservation interval and safe client behavior are isolated in [ADR 0006](adr/0006-production-atrium-boundary.md).

## Technology choices

- Browser: WXT, React, TypeScript, Manifest V3, Chrome Side Panel, IndexedDB.
- Mac: Swift, SwiftUI, AppKit, ScreenCaptureKit, Accessibility, Core Graphics, Keychain, AuthenticationServices.
- Workspace: pnpm monorepo for TypeScript; Xcode/Swift Package Manager for native code.
- Testing: Vitest/unit tests, extension-loaded Playwright, JSON Schema contract fixtures, Swift XCTest, and image goldens.

## Product visual language

The side panel and Mac workspace share semantic presentation roles—evergreen primary actions, mint review states, warm neutral canvas, white panels, quiet metadata, and explicit privacy cues—while retaining platform-native layouts and controls. No production screenshot or Atrium frontend asset is shipped. [ADR 0005](adr/0005-atrium-aligned-visual-language.md) records the design boundary and accessibility requirements.
