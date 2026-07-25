# Mac companion runbook

## Supported environment

- macOS 14 Sonoma or newer on Apple silicon or Intel.
- Full Xcode/Command Line Tools with a matching Swift compiler and SDK.
- Screen Recording for pixels and Accessibility for semantic events/global shortcuts.
- A district signing identity, notarization credentials, and MDM profile only for external release. The approved production OAuth public client is bundled.

The repository has no third-party Swift dependency. Native code links only Apple system frameworks and repository MIT code.

## Build and local verification

From the repository root:

```sh
docker run --rm -v "$PWD:/workspace" -w /workspace swift:6.0-bookworm \
  swift test --package-path apps/macos
scripts/build-macos-app.sh
```

`scripts/build-macos-app.sh` produces the ignored `dist/macos/Atrium Capture.app`. Before assembling it, the script:

1. compiles every native product in release mode;
2. runs a Core Graphics golden that verifies opaque replacement pixels and absence of forbidden PNG metadata chunks;
3. verifies a real AppKit floating pin and the production gateway's private/bodyless object, direct-upload header, version ETag, and internal-publication contract with synthetic responses;
4. sends the shared bridge fixture to the native host and proves a payload containing `imageData` is rejected;
5. validates `Info.plist`; and
6. applies and verifies a stable signature when
   `ATRIUM_CAPTURE_CODESIGN_IDENTITY` is supplied, otherwise an ad-hoc local
   hardened-runtime signature unless `ATRIUM_CAPTURE_ADHOC_SIGN=0`.

The local Command Line Tools installation may expose a default SDK whose Swift module version differs from its compiler. The build script selects the installed macOS 15.4 SDK when present. CI uses `macos-15` with full Xcode, runs XCTest, then assembles the app.

An ad-hoc signature is suitable for build verification but not durable macOS
privacy authorization: rebuilding changes its code identity. System Settings can
therefore retain an older Atrium Capture entry while the new local binary still
needs approval. For interactive acceptance, use a stable Apple Development or
district identity:

```sh
ATRIUM_CAPTURE_CODESIGN_IDENTITY="Apple Development: Approved Developer" \
  scripts/build-macos-app.sh
open "dist/macos/Atrium Capture.app"
```

The usage description in `Info.plist` explains the request; it does not grant the
permission. The app links directly to the Screen Recording and Accessibility
privacy panes. Atrium Capture requests one missing grant at a time so macOS
cannot supersede one TCC prompt with the next: approve Screen Recording first,
reopen if requested, then choose **Grant Accessibility**. After both grants are
effective, the Capture Access card disappears; revoking either grant makes it
reappear and pauses an active recording.

## Local data and privacy boundary

Application data is under `~/Library/Application Support/AtriumCapture`:

- `recorder-state.json`: active normalized session and bounded event receipts;
- `sessions/`: reviewed contract documents;
- `outbox/`: durable publish jobs and remote IDs;
- `assets/<session>/raw/`: local originals that can never enter the outbox;
- `assets/<session>/publishable/`: newly flattened, metadata-stripped PNGs;
- `assets/pin-history/pins/`: local pin history; and
- `pin-history.json`: bounded pin metadata and clipboard retention policy.

The safest default deletes raw bytes after flattening. The session tombstone is durable before file deletion. Never collect or attach this directory to a support ticket; diagnostics use fixed codes only.

## Permission behavior

| State                                  | Expected behavior                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Neither permission granted             | App launches in editor/history mode; recording controls explain the requirement.                             |
| Screen Recording only                  | Region pixels are available; semantic workflow and element capture remain gated.                             |
| Accessibility only                     | No screenshots are captured; recording remains gated.                                                        |
| Both granted                           | Capture Access card hides; workflow, region, element, shortcuts, magnifier, and color readout are available. |
| Either permission revoked while active | The two-second point-of-use check pauses recording and stops global monitors.                                |

The Accessibility adapter never reads an element value. A secure-text role is rejected before screenshot capture and its receipt is persisted so restart does not reprocess it. Ordinary input produces “Enter the requested value…” and never the literal text. Every screenshot-bearing input step requires an opaque redaction before flattening or publishing; blur and mosaic do not satisfy that gate.

## Synthetic M6 acceptance

Use synthetic names and empty test documents only:

1. Launch the signed app, choose **Grant Screen Recording**, approve it in System Settings, and reopen if prompted. Then choose **Grant Accessibility** and reopen if macOS does not apply it live.
2. Start a recording.
3. In Finder, select a folder named `Atrium Synthetic Fixture`.
4. In System Settings, select a non-sensitive navigation item; do not open accounts, passwords, profiles, or production configuration.
5. In an Office application, use an empty document named `Synthetic Guide`; click a ribbon control and type only `SYNTHETIC-NONPERSONAL` into an ordinary field.
6. Stop. Confirm each step card visibly renders its local screenshot preview, three app identities, ordered generic actions, no typed literal, and no secure-field step.
7. Edit an instruction, add a redaction/annotation, flatten, approve, and verify the session becomes `publishable` with only deleted or `publishable_local` assets.
8. With `ATRIUM_CAPTURE_LOCAL_MOCK=1`, create a private draft, terminate after any injected phase in tests, retry, and confirm one object/asset/version. Do not use real district content.
9. For authenticated acceptance, use the bundled public native client, sign in to AI Studio, create one synthetic private draft, and exercise the separate internal-publication button. Use the `AtriumOAuthClientId` MDM preference only to target a separately approved test client.

The committed `capture-session-macos-v1.json` fixture provides the automated language-neutral equivalent and decodes in TypeScript and Swift.

## M7 overlay acceptance matrix

Shortcuts are `⌥⌘A` for a region, `⌥⌘E` for the focused element, and `⌥⌘P` to show/hide pins.

For each attached display and scale factor:

1. Drag a region in all four directions; verify the size label, magnifier, and hex color readout.
2. Capture near every display edge and verify dimensions against the selected point rectangle and Retina pixel scale.
3. Pin a reviewed image, move/resize it, toggle click-through, assign a group, hide/show pins, and restart the app to verify history recovery.
4. Verify the pin remains floating in another Space and beside a full-screen synthetic application.
5. Select each clipboard policy. For timed clearing, copy another value before expiry and confirm Atrium Capture does not erase the newer clipboard owner.
6. Revoke Screen Recording and Accessibility separately while recording and confirm recording pauses without storing a partial step.

Automated tests cover mixed positive/negative display origins, independent X/Y scales, drag normalization, pixel color addressing, history eviction, group/click-through persistence, clipboard policy persistence, serialized capture, and permission-driven pause source paths. The native verifier constructs a real AppKit pin and asserts floating, click-through, all-Spaces, and full-screen auxiliary behavior.

## Optional Chrome enrichment

The extension declares `nativeMessaging` as an optional permission and requests it only when the user selects **Enable Mac enrichment**. Install the host only for a local/district-managed test:

```sh
scripts/install-native-host.sh "dist/macos/Atrium Capture.app" chrome
```

The installer writes a user-specific Chrome manifest with the stable extension ID and absolute helper path. It does not run during build. Use `chrome-for-testing` or `chromium` as the second argument for those documented locations. Disable enrichment in the side panel to remove the optional Chrome permission; remove the host manifest during rollback.

## Live integration and release gates

Normal builds include the documented production gateway and approved public
native client UUID. Employees do not configure it. MDM may supply:

- `AtriumOAuthClientId`: optional approved test-client override.
- `AtriumDefaultCollectionId`: optional documented collection UUID.

For local synthetic testing, the equivalent public-only environment variables are `ATRIUM_CAPTURE_OAUTH_CLIENT_ID` and `ATRIUM_CAPTURE_DEFAULT_COLLECTION_ID`. Tokens remain in Keychain, are refreshed through the public-client rotation flow, and never enter native messaging or local diagnostics.

Run `pnpm smoke:atrium` before authenticated acceptance. The Mac token request is a native `URLSession` request and does not depend on the separate browser-extension CORS allowlist. District sign-in and callback/token persistence are live verified on an ad-hoc build; private-draft acceptance still requires the capture permissions above and should be repeated on the stably signed pilot build. The remaining browser token and asset-initiation limitations are described in ADR 0006. District signing, notarization, MDM packaging, host installation, OAuth registration, and deployment require explicit authorization and credentials/configuration outside this repository.
