---
type: Guide
title: Development and Verification
description: Commands and evidence required to validate contracts, browser workflows, native workflows, privacy, packaging, licenses, and dependencies.
tags: [development, testing, ci, verification]
---

# Development and Verification

Use Node.js 24+, pnpm 9.15.2, Swift 6, and a matching macOS SDK. Tests contain
only synthetic data and do not require district credentials.

## Complete local gate

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm security:audit
pnpm build:mac
```

`pnpm check` runs formatting, ESLint, strict TypeScript, contract/message
generation freshness, unit and integration tests, the production extension
build, extension-loaded Chromium tests, browser packaging, Swift tests, and
license checks.

The extension suite loads the production Manifest V3 build in a persistent
Chromium profile and forces a service-worker restart. Image goldens inspect
decoded output pixels and metadata chunks. Native tests decode the same fixtures
and verify recorder recovery, privacy review, durable publication, display
geometry, pins, and bridge rejection.

The macOS build runs real Apple-framework verifiers and produces either a
stable-signed app when `ATRIUM_CAPTURE_CODESIGN_IDENTITY` is supplied or an
ad-hoc build-only artifact. It does not notarize, install, upload, or deploy.

`pnpm smoke:atrium` is an optional credential-free check of production OIDC
discovery and the fail-closed collection boundary. Registered-client mode also
requires a real authorization HTTP redirect. Authenticated acceptance uses the
bundled clients and synthetic content after Atrium's first-party login gate
passes.

CI is defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
Detailed evidence is in [`docs/verification.md`](../../docs/verification.md).
