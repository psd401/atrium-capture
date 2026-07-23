# Milestones

Verification evidence is recorded in [verification.md](verification.md). M0 through M2 are complete; later milestones remain open until their exit gates pass.

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

Dependencies: Atrium production OAuth and content assets. Collection discovery is required for the picker.

## M4 — District browser pilot

- Managed policy for site access, URL retention, raw-image retention, and default collection.
- Accessibility, permission rationale, diagnostics/export, storage quotas, and update/deployment runbook.
- Security review and authenticated end-to-end tests against development Atrium.

Exit gate: pilot checklist, privacy review, rollback, and support diagnostics are approved.

Dependency: Atrium idempotency/concurrency before broad rollout.

## M5 — Browser v1

- Performance and long-session hardening.
- Store/managed-distribution packaging, release signing, telemetry-free operational health, and documentation.

Exit gate: v1 release artifact passes automated and manual acceptance on district-supported Chrome/macOS combinations.

## M6 — Mac recorder companion

- Native OAuth with Keychain.
- ScreenCaptureKit window/display capture and Accessibility semantic events.
- Same editor/publish workflow and fixture corpus.
- Optional metadata-only Chrome native messaging enrichment.

Exit gate: a Finder/System Settings/Office workflow produces the same valid Atrium document model as a browser workflow.

Dependency: RFC 8252 native redirect support and production OAuth.

## M7 — Snipaste-style Mac tools

- Region/element capture, magnifier, color readout, global shortcuts, multi-monitor/Retina correctness.
- Always-on-top pins, click-through behavior, pin groups/history, and clipboard workflow under district retention policy.

Exit gate: native overlay behavior is reliable across Spaces, displays, scale factors, full-screen applications, and permission changes.
