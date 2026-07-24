# Mac companion

Atrium Capture for Mac is a native SwiftUI/AppKit application targeting macOS 14 or later. It uses ScreenCaptureKit for pixels, Accessibility for bounded semantics, Core Graphics for flattened exports, Keychain and `ASWebAuthenticationSession` for native OAuth, and the generated language-neutral contracts for persisted sessions and publish jobs.

Build and verify the application bundle from the repository root:

```sh
scripts/build-macos-app.sh
```

The script builds the release executables, runs the native pixel/metadata verifier, exercises the metadata-only native host, assembles `dist/macos/Atrium Capture.app`, validates its plist, and applies an ad-hoc local signature. It does not notarize, upload, install a native host, or deploy anything.

Swift Package products:

- `AtriumCaptureContracts`: generated contract models and the shared JSON codec.
- `AtriumCaptureCore`: recorder recovery, review commands, durable publisher, bridge validation, display geometry, and pin history.
- `AtriumCaptureMacPlatform`: ScreenCaptureKit, Accessibility, Core Graphics, AuthenticationServices, Keychain, overlays, pins, shortcuts, and clipboard adapters.
- `AtriumCaptureMacApp`: SwiftUI application executable.
- `AtriumCaptureNativeHost`: Chrome length-prefixed metadata bridge.
- `AtriumCaptureMacVerifier`: native redaction/metadata/window-policy acceptance executable.

The default application uses the documented production `NativeAtriumGateway` when MDM supplies `AtriumOAuthClientId`; otherwise it fails closed without disabling local capture/review. Set `ATRIUM_CAPTURE_LOCAL_MOCK=1` only for a visibly local private-draft demonstration. See [the Mac runbook](../../docs/macos-runbook.md) for permissions, synthetic acceptance, OAuth configuration, native-host registration, data retention, and external release dependencies.
