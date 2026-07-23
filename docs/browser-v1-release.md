# Browser v1 release and acceptance

## Release candidate

The browser package version is `1.0.0`. `pnpm package:browser` builds the production Manifest V3 extension, creates an unsigned Chrome ZIP under `apps/browser-extension/.output`, inspects its ZIP central directory, and writes `browser-release-manifest.json` with the artifact byte size and SHA-256 digest.

Package verification fails if the archive omits the manifest, worker, content script, side panel, or managed schema; changes the reviewed required permissions or the single optional `nativeMessaging` permission; or includes source maps, TypeScript, tests, fixtures, dependencies, environment files, or key material. The optional permission is requested only from the Mac-enrichment user gesture and is removed when enrichment is disabled. The release manifest also records that telemetry and live Atrium are disabled.

The ZIP is intentionally unsigned. Chrome Web Store or district managed-distribution signing requires an authorized publisher and external signing custody. Per repository policy, no upload, signing-key creation, update host, deployment, or release occurs without explicit approval.

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

Run `swift test --package-path apps/macos` with a matched Swift compiler/SDK as the cross-contract guard. The release operator records the exact ZIP and SHA-256 from the generated release manifest; rebuilding creates a new candidate and requires repeating acceptance.

## Supported browser matrix

Browser v1 targets current district-managed Google Chrome on macOS 14 and 15; the manifest's technical minimum is Chrome 116 for the APIs used. Before promotion, support validates both the district Stable and any district Extended Stable channel in the oldest and newest supported macOS versions.

| Check                                       | Automated production Chromium | District Chrome/macOS manual ring |
| ------------------------------------------- | ----------------------------- | --------------------------------- |
| Install, fixed ID, manifest, managed schema | Pass                          | Required before promotion         |
| Start/pause/resume/stop and cross-page flow | Pass                          | Required                          |
| Forced worker stop/recovery/deduplication   | Pass                          | Spot check                        |
| Password/input privacy                      | Pass                          | Required with synthetic fields    |
| Review tools and irreversible redaction     | Pass                          | Required at normal and 200% zoom  |
| Managed allow/deny and retention            | Unit/integration pass         | Required through MDM              |
| Diagnostics download and local deletion     | Pass                          | Required                          |
| Private Atrium draft/internal publication   | Mock pass                     | Blocked until live contracts      |

The manual ring uses only the repository's synthetic fixture. It must not record production/student content for acceptance.

## Long-session and operational health

- The managed default ceiling is 1,000 steps and 512 MiB of local image bytes. Recording pauses before it would exceed either configured bound.
- Duplicate clicks/navigation and merged input intent are classified before screenshot capture, avoiding expensive images that the reducer will discard.
- The core reducer test creates 1,000 ordered unique steps; IndexedDB receipts, restart recovery, and service-level quota behavior remain covered.
- The worker keeps at most 100 generic health events and exports the latest 20. Events contain only a fixed code, severity, and timestamp. There is no analytics SDK, crash reporter, beacon, or automatic export.
- The side panel loads only the selected screenshot. Diagnostic polling is five seconds and contains no capture content.

## Store/managed submission checklist

- [ ] Obtain explicit approval to publish or deploy.
- [ ] Confirm candidate git commit is clean and all automated gates pass.
- [ ] Record artifact filename, SHA-256, size, permissions, extension ID, and version.
- [ ] Review store description/screenshots/privacy disclosure with synthetic assets only.
- [ ] Keep publisher/signing credentials outside the repository and build logs.
- [ ] Configure OAuth redirect for the immutable extension ID only after Atrium registration exists.
- [ ] Promote through the engineering/support/pilot rings in `browser-pilot-runbook.md`.
- [ ] Exercise rollback before broad promotion.
- [ ] Retain the signed artifact and its approval record; do not retain captured guide data.
