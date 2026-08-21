# Mac companion

Atrium Capture for Mac is a native SwiftUI/AppKit application targeting macOS 14 or later. It uses ScreenCaptureKit for pixels, Accessibility for bounded semantics, Core Graphics for flattened exports, Keychain and `ASWebAuthenticationSession` for native OAuth, and the generated language-neutral contracts for persisted sessions and publish jobs.

Build and verify the application bundle from the repository root:

```sh
scripts/build-macos-app.sh
```

The script builds the release executables, runs the native pixel/metadata verifier, exercises the metadata-only native host, assembles `dist/macos/Atrium Capture Local.app`, validates its plist, and defaults to an ad-hoc local signature. The local app uses the distinct `org.psd401.AtriumCapture.Local` identity so development builds cannot impersonate the production app in macOS privacy settings. It does not notarize, upload, install a native host, or deploy anything.

If a legacy `dist/macos/Atrium Capture.app` is still present, the local build
stops with a cleanup message instead of silently leaving an ambiguous
production-named copy beside the local app.

Build the universal Apple silicon + Intel installer from the repository root:

```sh
ATRIUM_CAPTURE_CODESIGN_IDENTITY="Apple Development: Approved Developer" \
  bun run package:mac
```

This produces `dist/macos/Atrium-Capture-<version>.pkg`, its SHA-256 file, and
`macos-package-manifest.json`. Package assembly requires a stable Apple signing
identity; an Apple Development-signed package is deliberately marked
`distributionReady: false`, and an ad-hoc production-identity package is
rejected.
The tag release workflow requires Developer ID Application and Installer
identities, Apple notarization, a stapled ticket, and Gatekeeper acceptance
before it publishes a GitHub release. The package declares that a running copy
must close, allows only a system-domain installation, disables bundle
relocation, and installs the app at
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
