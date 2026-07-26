# Browser v1 release and acceptance

## Release candidate

The browser package version is `1.0.1`. `pnpm package:browser` builds the
production Manifest V3 extension, creates an unsigned Chrome ZIP under
`apps/browser-extension/.output`, inspects its ZIP central directory, and writes
`browser-upload-manifest.json` with the artifact byte size and SHA-256 digest.
The manifest labels the ZIP as a Chrome Web Store upload and sets
`distributionReady: false`; it is not a signed release.

The archive is rebuilt from sorted production files with fixed entry timestamps
and permissions. Package verification regenerates it independently and requires
byte equality, so an unchanged source/build produces the same upload SHA-256.
This makes the eventual signed-store receipt meaningful rather than tying it to
one nondeterministic packaging run.

Package verification fails if the archive omits the manifest, worker, content
script, side panel, or managed schema; includes the development-only public
`key`; changes the reviewed required permissions or the single optional
`nativeMessaging` permission; or includes source maps, TypeScript, tests,
fixtures, dependencies, environment files, or key material. The verifier
independently derives the store item ID from the committed public key before
writing the release manifest. The optional permission is requested only from
the Mac-enrichment user gesture and is removed when enrichment is disabled. The
release manifest records that telemetry is disabled and live Atrium uses the
bundled approved public client.

The manifest includes 16, 32, 48, and 128 pixel install icons, with 16 and 32
pixel toolbar variants. They are exact mechanical derivatives of the original
MIT-licensed Atrium Capture master used by the Mac app. Package verification
checks that every PNG is present and has its declared dimensions.

The approved distribution target is a **private PSD-only Chrome Web Store
item**, promoted through district-managed Chrome rings. It must not be publicly
listed, and this repository does not operate a private CRX update host. Store
signing is performed by the verified Peninsula School District publisher;
credentials and signing custody remain outside the repository. See
[ADR 0008](adr/0008-private-psd-distribution.md) and the
[private submission copy](browser-store-submission.md).

## Automated acceptance

Run from a clean checkout at the candidate commit:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:check
pnpm messages:check
pnpm test
pnpm build
pnpm test:extension
pnpm package:browser
pnpm licenses:check
pnpm security:audit
```

Run `swift test --package-path apps/macos` with a matched Swift compiler/SDK as
the cross-contract guard. The release operator records the exact ZIP and SHA-256
from the generated upload manifest; rebuilding creates a new candidate and
requires repeating acceptance.

After the exact ZIP is signed and published privately, record the PSD-only
store result in the ignored
`apps/browser-extension/.output/browser-distribution-receipt.json` and run:

```sh
pnpm verify:pilot
```

The receipt must use this non-secret shape:

```json
{
  "schemaVersion": 1,
  "signed": true,
  "distribution": "chrome_web_store_private",
  "visibility": "psd_only",
  "status": "published",
  "extensionId": "eomlblaiglafndhplfhilmdcaofhkkbj",
  "version": "1.0.1",
  "uploadSha256": "<exact browser-upload-manifest sha256>"
}
```

The pilot gate also requires a stable Apple-signed Mac app. The stricter
`pnpm verify:distribution` requires a Developer ID Application signature
accepted by Gatekeeper.

## Supported browser matrix

Browser v1 targets current district-managed Google Chrome on macOS 14 and 15; the manifest's technical minimum is Chrome 116 for the APIs used. Before promotion, support validates both the district Stable and any district Extended Stable channel in the oldest and newest supported macOS versions.

| Check                                       | Automated production Chromium | District Chrome/macOS manual ring       |
| ------------------------------------------- | ----------------------------- | --------------------------------------- |
| Install, fixed ID, manifest, managed schema | Pass                          | Required before promotion               |
| Start/pause/resume/stop and cross-page flow | Pass                          | Required                                |
| Forced worker stop/recovery/deduplication   | Pass                          | Spot check                              |
| Password/input privacy                      | Pass                          | Required with synthetic fields          |
| Review tools and irreversible redaction     | Pass                          | Required at normal and 200% zoom        |
| Managed allow/deny and retention            | Unit/integration pass         | Required through MDM                    |
| Diagnostics download and local deletion     | Pass                          | Required                                |
| Private Atrium draft/internal publication   | Production-contract mock pass | Requires registered client/test account |

The manual ring uses only the repository's synthetic fixture. It must not record production/student content for acceptance.

## Long-session and operational health

- The managed default ceiling is 1,000 steps and 512 MiB of local image bytes. Recording pauses before it would exceed either configured bound.
- Duplicate clicks/navigation and merged input intent are classified before screenshot capture, avoiding expensive images that the reducer will discard.
- The core reducer test creates 1,000 ordered unique steps; IndexedDB receipts, restart recovery, and service-level quota behavior remain covered.
- The worker keeps at most 100 generic health events and exports the latest 20. Events contain only a fixed code, severity, and timestamp. There is no analytics SDK, crash reporter, beacon, or automatic export.
- The side panel loads only the selected screenshot. Diagnostic polling is five seconds and contains no capture content.

## Store/managed submission checklist

- [x] Obtain approval for private PSD-only publication; public listing is forbidden.
- [x] Confirm all automated engineering gates pass.
- [x] Record artifact filename, SHA-256, size, permissions, extension ID, and version.
- [x] Confirm the existing private store item owns extension ID `eomlblaiglafndhplfhilmdcaofhkkbj`.
- [x] Review store description/screenshots/privacy disclosure with synthetic assets only.
- [ ] Keep publisher/signing credentials outside the repository and build logs.
- [x] Register the immutable extension redirect and bundle its public UUID; managed policy is only an approved test-client override.
- [ ] Publish the committed browser privacy policy at a stable public HTTPS URL.
- [ ] Verify the publisher contact email.
- [ ] Enable own-domain publishing or complete PSD organization approval; do not
      use trusted testers as the district-wide distribution mechanism.
- [ ] Publish the exact ZIP with private PSD-only visibility and record the matching receipt.
- [ ] Run `pnpm verify:pilot`; do not call the upload ZIP release-ready.
- [ ] Promote through the engineering/support/pilot rings in `browser-pilot-runbook.md`.
- [ ] Exercise rollback before broad promotion.
- [ ] Retain the signed artifact and its approval record; do not retain captured guide data.
