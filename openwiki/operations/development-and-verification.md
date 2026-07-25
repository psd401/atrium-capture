---
type: Guide
title: Development and Verification
description: Commands and evidence required to validate contracts, browser workflows, native workflows, privacy, packaging, licenses, and dependencies.
tags: [development, testing, ci, verification]
---

# Development and Verification

Use Node.js 24+, pnpm 9.15.2, Swift 6, and a matching macOS SDK. Tests contain
only synthetic data and do not require district credentials.

## Engineering and release gates

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm security:audit
pnpm build:mac
pnpm verify:pilot
```

`pnpm check` runs formatting, ESLint, strict TypeScript, contract/message
generation freshness, unit and integration tests, the production extension
build, extension-loaded Chromium tests, browser packaging, Swift tests, and
license checks.

`pnpm check` is an engineering gate, not a release-readiness claim.
`pnpm verify:pilot` additionally requires a matching signed, published, private
PSD-only Chrome Web Store receipt and a stable Apple-signed Mac app.
`pnpm verify:distribution` further requires a Developer ID Application
signature accepted by Gatekeeper.

The extension suite loads the production Manifest V3 build in a persistent
Chromium profile and forces a service-worker restart. Image goldens inspect
decoded output pixels and metadata chunks. Native tests decode the same fixtures
and verify recorder recovery, privacy review, durable publication, display
geometry, pins, and bridge rejection.

The macOS build runs real Apple-framework verifiers and produces either a
stable-signed app when `ATRIUM_CAPTURE_CODESIGN_IDENTITY` is supplied or an
ad-hoc build-only artifact. It does not notarize, install, upload, or deploy.

The three production smokes verify OIDC/client registration, browser token
CORS, and every extension-worker content route without credentials.
Authenticated acceptance uses the bundled clients and synthetic content; both
browser and native private-draft paths are live verified.

CI is defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
Detailed evidence is in [`docs/verification.md`](../../docs/verification.md).
