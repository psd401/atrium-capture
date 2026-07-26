# Milestones

Verification evidence is recorded in [verification.md](verification.md).
Production private-draft publishing is accepted from both clients with
synthetic fixtures. M0-M3 and M6 meet their exit gates; M4, M5, and M7 have
complete locally automatable engineering work but remain open until their
documented district pilot, signed distribution, and physical-device matrices
pass. An unsigned upload ZIP or ad-hoc app is never counted as a release
artifact.

## M0 — Contracts and repository foundation

- Validate `CaptureSession`, `PublishJob`, and native bridge schemas.
- Add TypeScript generation and a Swift decoding fixture test.
- Establish CI, license/dependency checks, synthetic fixture site, and threat model.
- Lock Chrome extension ID, Atrium OAuth redirect/client registration plan, macOS bundle ID, and minimum OS decision.

Exit gate: the same session fixture validates and decodes in TypeScript and Swift; no platform code invents a second model.

## M1 — Browser recorder alpha

- Start, pause, resume, stop.
- Capture click, input intent, select, submit, shortcut, and navigation.
- Serialize event processing, merge low-value duplicates, capture visible-tab screenshots, and recover after service-worker restart.
- Live side-panel step list and synthetic local fixtures.

Exit gate: a multi-page synthetic workflow survives a forced service-worker stop without losing or duplicating acknowledged steps; password/input-value tests pass.

## M2 — Review, annotation, and privacy beta

- Reorder, delete, merge, insert, crop, zoom, arrow, rectangle, text, highlight, mosaic, and permanent redaction.
- Automated sensitive-region flags plus mandatory redaction review.
- Produce publishable flattened images and delete raw originals according to policy.

Exit gate: golden tests prove exported pixels contain no recoverable redacted content or source metadata.

## M3 — Atrium draft publishing

- Authorization Code + PKCE.
- Collection picker or managed-default fallback.
- Durable outbox and Atrium gateway.
- Create a private object, upload immutable assets, create a Markdown version, and return its private Atrium authoring link.
- Explicit internal publication after review.

Exit gate: network interruption at every phase resumes without duplicate content/assets/versions; private is the default.

Production status: the documented OAuth, collection, content, version,
authored-asset, title-update, and internal-publication clients are implemented
and contract-tested. Both administrator-registered public client UUIDs are
bundled. Authorization redirects, district login, exact first-party no-consent
behavior, browser token exchange, idempotent asset initiation, direct S3 upload,
completion, and version creation are live verified. The extension produced a
six-image private draft; its exact title, instructions, authoring route, and
loaded image elements were verified in Atrium. The signed Mac app produced a
two-image private draft with one current version and a synchronized title.
Final product training documents were then submitted through the same
private-default path: a five-step browser-extension walkthrough and a ten-step
Mac-app walkthrough. All 15 reviewed images reached ready state and the
rendered first, middle, and final steps were visually inspected in Atrium.

## M4 — District browser pilot

- Managed policy for site access, URL retention, raw-image retention, and default collection.
- Accessibility, permission rationale, diagnostics/export, storage quotas, and update/deployment runbook.
- Security review and authenticated end-to-end tests against development Atrium.

Exit gate: pilot checklist, privacy review, rollback, and support diagnostics are approved.

Local status: engineering acceptance is complete. Credential-free
discovery/registration, token, and real extension-worker content-route smokes
pass, as does authenticated production private-draft acceptance with the
committed synthetic fixture. Broad rollout still requires the district pilot
checklist, Chrome managed deployment approval, and supported-device validation.

## M5 — Browser v1

- Performance and long-session hardening.
- Store/managed-distribution packaging, release signing, telemetry-free operational health, and documentation.

Exit gate: v1 release artifact passes automated and manual acceptance on district-supported Chrome/macOS combinations.

Current status: the district publisher is verified and owns private draft item
`eomlblaiglafndhplfhilmdcaofhkkbj`. The accepted unpublished `1.0.0` bootstrap
established its authoritative ID and public key; the reviewed `1.0.1` candidate
uses that identity in development while correctly omitting `key` from its store
upload. Final private review, store signing, `pnpm verify:pilot`, and
managed-ring acceptance remain. The unsigned ZIP is not a release artifact.

## M6 — Mac recorder companion

- Native OAuth with Keychain.
- ScreenCaptureKit window/display capture and Accessibility semantic events.
- Same editor/publish workflow and fixture corpus.
- Optional metadata-only Chrome native messaging enrichment.

Exit gate: a Finder/System Settings/Office workflow produces the same valid Atrium document model as a browser workflow.

Production status: RFC 8252-style native redirects, production
OAuth/refresh/revocation, Keychain storage, direct authored-asset upload,
private drafts, title synchronization, and internal publication are
implemented. The approved public native client UUID is bundled. District
sign-in, registered callback, token exchange, Keychain persistence, connected UI
state, both native capture permissions, and a two-image private draft with a
current version are live verified on an Apple Development-signed build. The
acceptance resumed the same durable job after an upload failure and created no
duplicate object or asset.

## M7 — Snipaste-style Mac tools

- Region/element capture, magnifier, color readout, global shortcuts, multi-monitor/Retina correctness.
- Always-on-top pins, click-through behavior, pin groups/history, and clipboard workflow under district retention policy.

Exit gate: native overlay behavior is reliable across Spaces, displays, scale factors, full-screen applications, and permission changes.
