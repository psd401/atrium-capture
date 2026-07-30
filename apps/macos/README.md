# Mac companion

Atrium Capture for Mac is a native SwiftUI/AppKit application targeting macOS 14 or later. It uses ScreenCaptureKit for pixels, Accessibility for bounded semantics, Core Graphics for flattened exports, Keychain and `ASWebAuthenticationSession` for native OAuth, and the generated language-neutral contracts for persisted sessions and publish jobs.

Build and verify the application bundle from the repository root:

```sh
scripts/build-macos-app.sh
```

The script builds the release executables, runs the native pixel/metadata verifier, exercises the metadata-only native host, assembles `dist/macos/Atrium Capture.app`, validates its plist, and applies an ad-hoc local signature. It does not notarize, upload, install a native host, or deploy anything.

Build the universal Apple silicon + Intel installer from the repository root:

```sh
pnpm package:mac
```

This produces `dist/macos/Atrium-Capture-<version>.pkg`, its SHA-256 file, and
`macos-package-manifest.json`. A local build may contain an ad-hoc or Apple
Development-signed app and is deliberately marked `distributionReady: false`.
The tag release workflow requires Developer ID Application and Installer
identities, Apple notarization, a stapled ticket, and Gatekeeper acceptance
before it publishes a GitHub release. The package installs the app at
`/Applications/Atrium Capture.app` and the metadata-only Chrome host manifest
at the system-managed native messaging location.

Swift Package products:

- `AtriumCaptureContracts`: generated contract models and the shared JSON codec.
- `AtriumCaptureCore`: recorder recovery, review commands, durable publisher, bridge validation, display geometry, and pin history.
- `AtriumCaptureMacPlatform`: ScreenCaptureKit, Accessibility, Core Graphics, AuthenticationServices, Keychain, overlays, pins, shortcuts, and clipboard adapters.
- `AtriumCaptureMacApp`: SwiftUI application executable.
- `AtriumCaptureNativeHost`: Chrome length-prefixed metadata bridge.
- `AtriumCaptureMacVerifier`: native redaction/metadata/window-policy acceptance executable.

The default application bundles the approved public native OAuth client and uses the documented production `NativeAtriumGateway`; employees configure nothing. MDM may override `AtriumOAuthClientId` only for a separately approved test client. Set `ATRIUM_CAPTURE_LOCAL_MOCK=1` only for a visibly local private-draft demonstration. See [the Mac runbook](../../docs/macos-runbook.md) for permissions, synthetic acceptance, OAuth configuration, native-host registration, data retention, and external release dependencies.

The installed app includes a menu-bar launcher for the workspace, region and
focused-element capture, and recording controls. Quick captures append to the
current unpublished guide. Start at login is an explicit user preference backed
by `SMAppService.mainApp`; no login helper or privileged daemon is bundled.
