---
type: Guide
title: Development and Verification
description: Commands and evidence required to validate contracts, browser workflows, native workflows, privacy, packaging, licenses, and dependencies.
tags: [development, testing, ci, verification]
---

# Development and Verification

Use Node.js 24+, Bun 1.2+, Swift 6, and a matching macOS SDK. Tests contain
only synthetic data and do not require district credentials.

## Engineering and release gates

```sh
bun install --frozen-lockfile
bun run check
bun run security:audit
bun run build:mac
bun run verify:pilot
```

`bun run check` runs formatting, ESLint, strict TypeScript, contract/message
generation freshness, unit and integration tests, the production extension
build, extension-loaded Chromium tests, browser packaging, Swift tests, and
license checks.

`bun run check` is an engineering gate, not a release-readiness claim.
`bun run verify:pilot` additionally requires a matching signed, published, private
PSD-only Chrome Web Store receipt and a stable Apple-signed Mac app.
`bun run verify:distribution` further requires a Developer ID Application
signature accepted by Gatekeeper.

The extension suite loads the production Manifest V3 build in a persistent
Chromium profile and forces a service-worker restart. Image goldens inspect
decoded output pixels and metadata chunks. Native tests decode the same fixtures
and verify recorder recovery, privacy review, durable publication, display
geometry, pins, and bridge rejection.

The macOS build runs real Apple-framework verifiers and produces a
`dist/macos/Atrium Capture Local.app` with bundle ID
`org.psd401.AtriumCapture.Local`. The distinct local identity prevents
development builds from impersonating the production app in macOS privacy
settings. A stable Apple identity via `ATRIUM_CAPTURE_CODESIGN_IDENTITY`
keeps the same local identity; production bundle `org.psd401.AtriumCapture`
requires explicit `ATRIUM_CAPTURE_PRODUCTION_BUNDLE=1` plus a stable signer.
Legacy `dist/macos/Atrium Capture.app` artifacts fail the build until removed.

The three production smokes verify OIDC/client registration, browser token
CORS, and every extension-worker content route without credentials.
Authenticated acceptance uses the bundled clients and synthetic content; both
browser and native private-draft paths are live verified.

CI is defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
Detailed evidence is in [`docs/verification.md`](../../docs/verification.md).
