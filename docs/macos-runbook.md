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

## Guide composition and app lifecycle

The first **Region** or **Element** quick capture creates a reviewable guide.
Every later quick capture appends another step to that same unpublished guide;
it does not replace the prior region. The title at the top of the workspace is
editable, and the manual-step row remains available both during review and
after publishable images have been prepared. Adding a region, element, or
manual step to a prepared guide returns it to privacy review so the new content
cannot bypass flattening and approval.

The guide title remains editable before and after Atrium draft creation. The
outbox freezes the original create title for safe idempotent recovery, then
reconciles later title edits through Atrium's documented metadata update route.
Step and image content stays frozen once a draft job begins because it belongs to
that durable version snapshot.

Choose **New guide** for an empty review workspace. **Continue recording** adds
new steps to the current unpublished guide without replacing its existing steps
or images. A guide with an Atrium job is frozen, so **Start new recording**
creates a separate guide instead. Starting or continuing first asks for one
display, one window, or a fixed region; every screenshot in that recording keeps
the selected scope. Background recovery cannot replace the active workspace.
Use **Open saved guide** to return to an earlier local guide. A quick capture
also appends to the current unpublished guide, or begins a new guide when the
current one already has an Atrium job.

While recording, the Recorder card shows retained image and queued-event counts.
Screenshot capture is retried twice after the initial attempt. If all attempts
fail, the semantic step is still saved without an image and the Recorder card
shows a fixed diagnostic count without recording window titles, control names,
or framework error details.

For signed local stress automation only, launch with
`ATRIUM_CAPTURE_LOCAL_MOCK=1`, an isolated absolute
`ATRIUM_CAPTURE_DATA_ROOT`, and
`ATRIUM_CAPTURE_TEST_RECORDING_SCOPE=automatic`, `region`, or `window`. Window
mode resolves only a visible window whose title exactly equals the synthetic
fixture title. The override is ignored unless local mock mode is enabled and its
data root is inside the system temporary directory; ordinary and production
launches always require the macOS display/window picker or the interactive
region selector.

Atrium Capture also remains available from its menu-bar item when the workspace
window is closed. The menu can show the workspace, capture a region or focused
element, control recording, and quit. **Start at Login** is available in that
menu and in app Settings through the macOS `SMAppService` login-item API. If
macOS reports that approval is required, choose **Approve in Login Items…** and
enable Atrium Capture in System Settings. Direct SwiftPM executables are not
installed apps and intentionally report this option as unavailable.

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
2. Choose **Region** twice using two synthetic areas. Confirm the second region appears as step 2 in the same guide, rename the guide, quit and reopen, and verify both steps and the edited title recover.
3. Add a synthetic manual step. Prepare publishable images, add one more manual step, and confirm the guide returns to review before it can publish.
4. Choose **New guide**, confirm the prior guide remains under **Open saved guide**, then return to it. Start a new recording while an older synthetic outbox job exists and confirm background recovery does not replace the active guide.
5. In Finder, select a folder named `Atrium Synthetic Fixture`.
6. In System Settings, select a non-sensitive navigation item; do not open accounts, passwords, profiles, or production configuration.
7. In an Office application, use an empty document named `Synthetic Guide`; click a ribbon control and type only `SYNTHETIC-NONPERSONAL` into an ordinary field.
8. Stop. Confirm each step card visibly renders its local screenshot preview, three app identities, ordered generic actions, no typed literal, and no secure-field step.
9. Select each edit tool and drag directly over the screenshot. Confirm redaction, blur, mosaic, highlight, rectangle, arrow, and text render immediately; drag arrows in all four directions; verify **Undo** beside **Done** removes the latest annotation; apply and reset the center crop. Blur and mosaic must remain labeled as visual effects rather than privacy redactions.
10. Add an opaque redaction to every flagged input screenshot, prepare publishable images, and verify the session becomes `publishable` with only deleted or `publishable_local` assets.
11. With `ATRIUM_CAPTURE_LOCAL_MOCK=1`, create a private draft, terminate after any injected phase in tests, retry, and confirm one object/asset/version. Rename before and after draft readiness; confirm one object has the latest title, title editing remains available, and step/image controls are frozen for that version. Do not use real district content.
12. For authenticated acceptance, use the bundled public native client, sign in to AI Studio, create one synthetic private draft, and exercise the separate internal-publication button. Use the `AtriumOAuthClientId` MDM preference only to target a separately approved test client.

The committed `capture-session-macos-v1.json` fixture provides the automated language-neutral equivalent and decodes in TypeScript and Swift.

### Publish recovery

If Atrium shows only the new title while Capture reports a publish failure, do not start the capture over and do not attach Application Support files to a ticket. A bodyless private object is the first durable phase; screenshots are uploaded only after Capture receives its object ID. The app shows the bounded Atrium code and support request ID when available. **Retry Atrium publish** reuses the persisted idempotency key and never selects a raw screenshot.

`INTERNAL_ERROR` while the outbox remains at `creating_object` means Atrium did not confirm the object-create response. The title may already exist, while the reviewed image remains local. Retry only after the Atrium service has reconciled the committed create and its idempotency state; a correct replay returns the original private object and continues with one asset and one version.

## M7 overlay acceptance matrix

Shortcuts are `⌥⌘A` for a region, `⌥⌘E` for the focused element, and `⌥⌘P` to show/hide pins.

For each attached display and scale factor:

1. Close the workspace, use the menu-bar item to reopen it, and launch a region and focused-element capture. Toggle **Start at Login**, approve it in Login Items if required, relaunch, then disable it after acceptance.
2. Drag a region in all four directions; verify the size label, magnifier, and hex color readout.
3. Capture near every display edge and verify dimensions against the selected point rectangle and Retina pixel scale.
4. Pin a reviewed image, move/resize it, toggle click-through, assign a group, hide/show pins, and restart the app to verify history recovery.
5. Verify the pin remains floating in another Space and beside a full-screen synthetic application.
6. Select each clipboard policy. For timed clearing, copy another value before expiry and confirm Atrium Capture does not erase the newer clipboard owner.
7. Revoke Screen Recording and Accessibility separately while recording and confirm recording pauses without storing a partial step.

Automated tests cover mixed positive/negative display origins, independent X/Y scales, drag normalization, pixel color addressing, history eviction, group/click-through persistence, clipboard policy persistence, serialized capture, and permission-driven pause source paths. The native verifier constructs a real AppKit pin and asserts floating, click-through, all-Spaces, and full-screen auxiliary behavior.

## Optional Chrome enrichment

The extension declares `nativeMessaging` as an optional permission and requests it only when the user selects **Enable Mac enrichment**. Install the host only for a local/district-managed test:

```sh
scripts/install-native-host.sh "dist/macos/Atrium Capture.app" chrome
```

The installer writes a user-specific Chrome manifest with the stable extension ID and absolute helper path. It does not run during build. Use `chrome-for-testing` or `chromium` as the second argument for those documented locations. Disable enrichment in the side panel to remove the optional Chrome permission; remove the host manifest during rollback.

The managed `.pkg` uses the stable `/Applications/Atrium Capture.app` path and
installs the same metadata-only manifest for all users under
`/Library/Google/Chrome/NativeMessagingHosts`. It carries no token, screenshot,
user data, daemon, or privileged helper.

## Jamf installer and GitHub release

`pnpm package:mac` assembles a universal Apple silicon + Intel product archive:

- `dist/macos/Atrium-Capture-<version>.pkg`;
- the adjacent `.sha256` checksum; and
- `dist/macos/macos-package-manifest.json`.

The verifier inspects the package payload, stable identifiers and install
paths, exact byte count, SHA-256 digest, both executable architectures, and the
native host manifest. A local ad-hoc or Apple Development build remains useful
for acceptance but is recorded as `distributionReady: false`.

Prepare a future release on a short-lived branch with
`pnpm release:prepare <major.minor.patch>`, review the version/build changes,
and merge that branch through the ordinary protected-`main` pull request. Then
run the **Release macOS installer** workflow from `main` with that version.
The workflow repeats `pnpm check` and the high-severity audit, imports release
credentials into an ephemeral keychain, signs the app and package, submits the
package to Apple notarization, staples and validates the ticket, and asks
Gatekeeper to assess the installer. Only after all gates pass does it create
the annotated tag, upload all assets to a draft release, and publish the release
for auto-provisioning. An exact `v<version>` tag pushed by a release operator
uses the same fail-closed path. The workflow requires these repository Actions
secrets:

- `MACOS_DEVELOPER_ID_APPLICATION_P12` and
  `MACOS_DEVELOPER_ID_APPLICATION_P12_PASSWORD`;
- `MACOS_DEVELOPER_ID_INSTALLER_P12` and
  `MACOS_DEVELOPER_ID_INSTALLER_P12_PASSWORD`;
- `MACOS_BUILD_KEYCHAIN_PASSWORD`;
- `MACOS_NOTARY_PRIVATE_KEY`;
- `MACOS_NOTARY_KEY_ID`; and
- `MACOS_NOTARY_ISSUER_ID`.

The two P12 values are base64 encodings of the district Developer ID
Application and Developer ID Installer certificates with their private keys.
The notary values are an App Store Connect API key, key ID, and issuer ID.
Credential material must never be committed, printed, attached to a release,
or placed in the Jamf policy.

Jamf auto-provisioning must accept only a release manifest with
`distributionReady: true`, verify the `.pkg` against the adjacent SHA-256, and
retain the GitHub tag/version as the package source version. The Self Service
policy installs the package without collecting or uploading
`~/Library/Application Support/AtriumCapture`. Promote it through engineering,
support, and pilot rings before broad availability. Rollback installs the last
approved package; it must not delete local unpublished guides.

## Live integration and release gates

Normal builds include the documented production gateway and approved public
native client UUID. Employees do not configure it. MDM may supply:

- `AtriumOAuthClientId`: optional approved test-client override.
- `AtriumDefaultCollectionId`: optional documented collection UUID.

For local synthetic testing, the equivalent public-only environment variables are `ATRIUM_CAPTURE_OAUTH_CLIENT_ID` and `ATRIUM_CAPTURE_DEFAULT_COLLECTION_ID`. Tokens remain in Keychain, are refreshed through the public-client rotation flow, and never enter native messaging or local diagnostics.

AI Studio sign-in uses Apple's `ASWebAuthenticationSession` with shared browser
state so district SSO can reuse the account already signed in to the browser.
On macOS, the system sends that request to the default browser when it supports
authentication sessions and falls back to Safari otherwise. Atrium Capture
retains Apple's protected callback handling and validates the OAuth state and
PKCE verifier before storing tokens in Keychain.

Run `pnpm smoke:atrium` before authenticated acceptance. The Mac token request
is a native `URLSession` request; browser token and extension-worker content
boundaries have their own credential-free probes. District sign-in and
callback/token persistence are live verified on an Apple Development-signed
build. That signed build also resumed the same durable synthetic job after a
direct-upload failure and produced one private draft with two images, a current
version, an authoring link, and a synchronized title without duplication.

For a repeatable private-draft acceptance of the assembled app, create a fresh
isolated root and run the app binary with the synthetic acceptance switches:

```sh
acceptance_root="$(mktemp -d /private/tmp/atrium-capture-production-acceptance.XXXXXX)"
ATRIUM_CAPTURE_PRODUCTION_ACCEPTANCE=1 \
ATRIUM_CAPTURE_UI_FIXTURE=review \
ATRIUM_CAPTURE_DATA_ROOT="$acceptance_root" \
  "dist/macos/Atrium Capture.app/Contents/MacOS/AtriumCaptureMacApp"
cat "$acceptance_root/acceptance-result.json"
```

The harness uses new UUIDs on every production run so capture provenance cannot
collide with an earlier synthetic guide. It may reuse a valid Keychain session
or show district login, creates only a private draft, never requests internal
publication, writes no token/content identifier/image to its bounded result,
and terminates itself. Success reports `ready_as_draft`, two assets, two steps,
an authoring link, and synchronized title status.

Repeat the physical capture-permission/device matrix above on the exact
district-signed, notarized package attached to the GitHub release before Jamf
broad-ring promotion. OAuth registration and deployment credentials remain
outside this repository.
