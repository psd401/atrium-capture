# Mac companion

Planned stack: SwiftUI shell, AppKit overlay/window management, ScreenCaptureKit, Core Graphics, Accessibility (`AXUIElement`), Keychain, and `ASWebAuthenticationSession`.

The Mac phase starts from the same `CaptureSession` and `PublishJob` contracts as the browser. It uploads screenshots directly to Atrium; a Chrome native messaging bridge is optional enrichment for DOM semantics and carries no image bytes.

Do not create the Xcode project until the district's minimum supported macOS version, bundle identifier, signing team, and MDM distribution path are recorded.

