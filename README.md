# Atrium Capture

Atrium Capture records a workflow, turns meaningful actions into an editable visual guide, and saves the reviewed result as an Atrium draft. The first application is a Chrome extension; the same capture contract is designed for an immediate Mac companion phase.

Browser v1 and the native Mac companion are locally buildable and tested. The
district Chrome Web Store publisher owns the private browser item
`eomlblaiglafndhplfhilmdcaofhkkbj`; the browser build produces a verified,
explicitly unsigned upload bundle for that item. The installed local Mac pilot
is Apple Development-signed with a stable bundle identity. A tag-driven,
fail-closed release workflow builds a universal notarized Mac installer for
Jamf after Developer ID release credentials are supplied. Both contain the
documented direct Atrium publisher and bundle their approved non-secret
production OAuth client IDs, so employees only sign in with their district AI
Studio account.

## Product boundary

- Browser v1: record browser workflows, review steps, permanently redact and annotate screenshots, then save a private Atrium draft or publish internally.
- Mac companion: capture native applications with ScreenCaptureKit and Accessibility metadata, add floating screenshot tools, and optionally enrich browser steps through a metadata-only native messaging bridge.
- Atrium is the system of record. This repository does not add a second hosted workspace or content database.

## Status

M0 through M7 are implemented locally. The production Manifest V3 extension and
native SwiftUI/AppKit companion record, recover, review, annotate, permanently
redact, and package synthetic workflows through the same generated contracts.
Durable browser and native publishers pass failure-after-commit tests and
production-contract request/response tests. Production acceptance is complete
with synthetic data: the extension recorded, reviewed, permanently redacted, and
published a six-image private draft whose title, instructions, and images were
verified in Atrium's editor; the Apple Development-signed Mac app resumed a
durable publish job without duplication and produced a two-image private draft
with a current version and synchronized title. Final synthetic
[training walkthroughs](docs/training-walkthroughs.md) were also submitted as
private Atrium drafts and visually verified: five browser-extension steps and
ten Mac-app steps, with every reviewed image loaded. The remaining release gates
are final private PSD-only Chrome Web Store review/managed deployment and
district Developer ID signing/notarization and Mac MDM ring acceptance.

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

See [docs/architecture.md](docs/architecture.md), [docs/milestones.md](docs/milestones.md), [docs/development.md](docs/development.md), [docs/atrium-integration.md](docs/atrium-integration.md), and [docs/security-and-privacy.md](docs/security-and-privacy.md). The generated, agent-navigable documentation entry point is [openwiki/index.md](openwiki/index.md).

## License

MIT. See [LICENSE](LICENSE).
