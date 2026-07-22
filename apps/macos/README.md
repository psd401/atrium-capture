# Mac companion

Planned stack: SwiftUI shell, AppKit overlay/window management, ScreenCaptureKit, Core Graphics, Accessibility (`AXUIElement`), Keychain, and `ASWebAuthenticationSession`.

The Mac phase starts from the same `CaptureSession` and `PublishJob` contracts as the browser. It uploads screenshots directly to Atrium; a Chrome native messaging bridge is optional enrichment for DOM semantics and carries no image bytes.

The shared-contract Swift package targets macOS 14. The bundle identifier, OAuth callback, signing boundary, and MDM distribution path are recorded in [ADR 0001](../../docs/adr/0001-platform-identifiers-and-support.md). An Xcode application project is deferred until the native application milestone; contract decoding remains independently testable with Swift Package Manager.
