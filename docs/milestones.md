# Milestones

Verification evidence is recorded in [verification.md](verification.md). M0 through M7 are locally complete; physical-device release acceptance remains in the Mac runbook. Live Atrium dependencies remain capability-gated as documented below.

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
- Create private object, upload immutable assets, create Markdown version, and return Atrium reader link.
- Explicit internal publication after review.

Exit gate: network interruption at every phase resumes without duplicate content/assets/versions; private is the default.

Production status: the documented OAuth, collection, content, version, authored-asset, and internal-publication clients are implemented and contract-tested. Both administrator-registered public client UUIDs are bundled. Authorization redirects, district login, and exact first-party no-consent behavior now work. Browser token exchange remains externally blocked because Atrium rejects the exact stable `chrome-extension://` origin before code validation. Atrium asset initiation still lacks idempotency, so the exact post-reservation/pre-response interval remains an external row-level deduplication gap; clients recover every later upload/completion interval safely.

## M4 — District browser pilot

- Managed policy for site access, URL retention, raw-image retention, and default collection.
- Accessibility, permission rationale, diagnostics/export, storage quotas, and update/deployment runbook.
- Security review and authenticated end-to-end tests against development Atrium.

Exit gate: pilot checklist, privacy review, rollback, and support diagnostics are approved.

Dependency: exact-client browser token CORS plus idempotent/recoverable asset initiation before broad rollout.

Local status: engineering-approved for synthetic/unpublished evaluation. Credential-free discovery/content-boundary and registered-client smokes pass. `pnpm smoke:atrium:browser-token` reproducibly returns `invalid_request_origin` from production without a credential or real code.

## M5 — Browser v1

- Performance and long-session hardening.
- Store/managed-distribution packaging, release signing, telemetry-free operational health, and documentation.

Exit gate: v1 release artifact passes automated and manual acceptance on district-supported Chrome/macOS combinations.

Local status: the `1.0.0` unsigned artifact passes automated production-Chromium acceptance and has a district Chrome/macOS ring checklist. Signing, store upload, and managed deployment require explicit approval and remain unperformed.

## M6 — Mac recorder companion

- Native OAuth with Keychain.
- ScreenCaptureKit window/display capture and Accessibility semantic events.
- Same editor/publish workflow and fixture corpus.
- Optional metadata-only Chrome native messaging enrichment.

Exit gate: a Finder/System Settings/Office workflow produces the same valid Atrium document model as a browser workflow.

Production status: RFC 8252-style native redirects, production OAuth/refresh/revocation, Keychain storage, direct authored-asset upload, private drafts, and internal publication are implemented. The approved public native client UUID is bundled. District sign-in, registered callback, token exchange, Keychain persistence, connected UI state, and both native capture permissions are live verified on an Apple Development-signed build. Private-draft acceptance remains a synthetic operator check and is independent of the browser-extension CORS blocker.

## M7 — Snipaste-style Mac tools

- Region/element capture, magnifier, color readout, global shortcuts, multi-monitor/Retina correctness.
- Always-on-top pins, click-through behavior, pin groups/history, and clipboard workflow under district retention policy.

Exit gate: native overlay behavior is reliable across Spaces, displays, scale factors, full-screen applications, and permission changes.
