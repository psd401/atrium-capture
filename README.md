# Atrium Capture

Atrium Capture records a workflow, turns meaningful actions into an editable visual guide, and saves the reviewed result as an Atrium draft. The first application is a Chrome extension; the same capture contract is designed for an immediate Mac companion phase.

## Product boundary

- Browser v1: record browser workflows, review steps, permanently redact and annotate screenshots, then save a private Atrium draft or publish internally.
- Mac companion: capture native applications with ScreenCaptureKit and Accessibility metadata, add floating screenshot tools, and optionally enrich browser steps through a metadata-only native messaging bridge.
- Atrium is the system of record. This repository does not add a second hosted workspace or content database.

## Status

M0 through M2 are complete: shared schemas generate TypeScript and Swift models, and the production Manifest V3 extension records, recovers, reviews, edits, permanently redacts, and flattens synthetic browser workflows with value-safe capture semantics. Publishing, pilot hardening, and Mac milestones remain pre-release.

## Repository map

```text
apps/
  browser-extension/   WXT + React Manifest V3 application
  macos/               SwiftUI/AppKit companion application
contracts/             Language-neutral JSON Schemas
packages/
  atrium-client/       Generated/handwritten TypeScript API boundary
  capture-core/        Platform-neutral capture normalization and step rules
  editor-model/        Crop, annotation, redaction, and ordering commands
  privacy/             Capture policy and sensitive-data detection
  test-fixtures/       Synthetic cross-platform golden fixtures
docs/                  Architecture, milestones, security, and Atrium integration
```

## Non-negotiable rules

- This is a greenfield MIT-licensed implementation. Do not copy code from Scribe, Snipaste, Mimik, or other products/repositories.
- Never capture password values. Typed values are omitted by default.
- Keep recordings local until the author explicitly submits a reviewed draft.
- Upload only flattened, publishable screenshots; never upload an unredacted original.
- Managed browser policy and support diagnostics are documented in [the pilot runbook](docs/browser-pilot-runbook.md); diagnostics are local and telemetry remains off.
- Browser content scripts are untrusted. Validate every privileged message in the extension service worker.
- The browser and Mac implementations share versioned contracts and fixtures, not platform-specific implementation code.

See [docs/architecture.md](docs/architecture.md), [docs/milestones.md](docs/milestones.md), [docs/development.md](docs/development.md), and [docs/security-and-privacy.md](docs/security-and-privacy.md).

## License

MIT. See [LICENSE](LICENSE).
