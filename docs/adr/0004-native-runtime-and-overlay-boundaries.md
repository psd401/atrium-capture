# ADR 0004: Native runtime, image commit, and overlay boundaries

- Status: accepted
- Date: 2026-07-22

## Context

The Mac companion needs native capture and floating-window behavior without creating a second contract model or making Apple frameworks prerequisites for testing recorder and publication correctness. Filesystem writes also cannot make a JSON state update and image deletion one atomic transaction, while privacy still requires raw pixels to remain impossible to publish after flattening.

## Decision

- Swift Package Manager builds three boundaries: generated `AtriumCaptureContracts`, platform-neutral `AtriumCaptureCore`, and `AtriumCaptureMacPlatform`. The SwiftUI app, native host, and native verifier are thin executable targets.
- `NativeRecorder` synchronously persists a session plus bounded event receipts before returning an event decision, including for rejected secure-field events. Screen capture is serialized with an explicit task tail because a Swift actor alone can re-enter at `await`; redundant merged-event raw files are immediately removed and unreferenced assets fail the review/publish gates.
- Accessibility reads role, title/description/help, position, size, window title, and application identity. It never requests `kAXValueAttribute` or selected text. `AXSecureTextField` events are rejected before ScreenCaptureKit runs.
- Core Graphics decodes the raw image, applies crop and visual annotations, renders opaque redactions last with copy blending, creates a new PNG, and removes `tEXt`, `iTXt`, `zTXt`, `eXIf`, and `tIME` chunks. Screenshot-bearing input/flagged steps require an opaque redaction before flattening or approval. Only referenced `publishable_local` derivatives enter a publish job.
- The filesystem flatten commit persists the derivative and raw-asset tombstone before deleting raw bytes. A crash can leave a tombstoned orphan but cannot make it publishable; startup/review cleanup may remove the orphan. This is the safe filesystem equivalent of the browser's IndexedDB transaction.
- All screen geometry uses Quartz global top-left coordinates. Conversion to pixels uses each display's independent width/height scale, and AppKit window frames are converted only at the adapter boundary.
- Region overlays and floating pins use AppKit panels with all-Spaces and full-screen auxiliary collection behavior. Pins are local-only history with count/byte bounds, explicit click-through, optional groups, and a clipboard policy that defaults to clearing only the unchanged Atrium-owned pasteboard item after two minutes.
- A SwiftUI `MenuBarExtra` shares the single main-actor capture model with the workspace window. Region capture, focused-element capture, recording control, workspace activation, and launch-at-login are alternate entry points into the same state machine rather than independent recorders. `SMAppService.mainApp` owns the user-controlled login item; no bundled daemon or privileged helper is introduced.
- Explicit quick captures append to the current reviewable guide and persist through the same receipt envelope. Adding a capture or manual step to a prepared-but-unpublished guide returns it to privacy review. Step/image edits freeze once a durable Atrium publish job exists, while title edits remain available and reconcile through the documented metadata route using the frozen-create-title design in [ADR 0007](0007-active-guides-and-title-synchronization.md).
- Native OAuth uses a caller-supplied documented HTTPS authorization/token configuration, Authorization Code with S256 PKCE, `ASWebAuthenticationSession`, bounded token response validation, and SecItem Keychain storage off the main thread. No client secret is shipped.
- Chrome enrichment is optional. The browser requests `nativeMessaging` only from a user gesture, and the service worker forwards a strict semantic subset after recorder persistence. Both ends reject token/image fields. The host is never installed by the build.

## Consequences

Core recovery, privacy, and display logic runs in a matched Swift 6 container, while actual Apple adapters build on macOS and the standalone verifier covers the native redaction and window policy. Raw-file deletion is recoverably conservative after a crash. Cross-display capture selects one display per region; a single selection does not span displays. The menu-bar extra keeps the app available when the workspace window closes, while start-at-login remains an explicit macOS user choice and may require Login Items approval. Live OAuth/publication and district signing remain capability or operator gates rather than guessed integrations.
