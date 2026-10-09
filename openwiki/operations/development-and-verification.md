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

## Workspace and dependency management

The repository is a single bun workspace. The root `package.json` declares
`workspaces` for `apps/*` and `packages/*`, and the root `overrides` and
`trustedDependencies` fields replace the former pnpm configuration. `bun.lock`
is the committed lockfile; CI and release installs use `bun install --frozen-lockfile`.
The repository does not pin a Bun version: `package.json` has no `packageManager`
field and the CI setup step does not specify one, so Bun 1.2+ is the documented floor.

Workspace-wide scripts fan out with `bun run --filter '@atrium-capture/*'`
(for example `build` and `typecheck`). The browser extension calls back to the
root with `bun run --cwd ../..` to run `messages:check` before building.

The root `overrides` pin several transitive versions. The `fx-runner` override
points to `packages/fx-runner-disabled`, a dependency-free module that fails
closed. It exists because WXT's Firefox launcher path pulls in a `shell-quote`
release with unpatched advisories. Chrome builds and extension tests never call
it, so the override must not be removed until a Firefox target is actually
scheduled (see the [quickstart backlog](../quickstart.md#backlog)).

### License gate

`scripts/check-licenses.mjs` (`bun run licenses:check`) does not use a package
manager report. It walks every installed package manifest under `node_modules`,
including nested trees, and skips first-party workspace packages that are
symlinked from inside the repository. It then checks each license expression
against an allowlist and reports unreviewed licenses with the affected packages.
It fails closed in three cases: a malformed installed manifest, a package
without a name or version, and a pnpm-managed `node_modules/.pnpm` tree. The
last case tells the operator to remove `node_modules` and run `bun install`.

`scripts/check-licenses.test.ts` is collected by the root `vitest run`. It covers
nested duplicate scanning, third-party packages under workspaces, malformed
manifests, and the pnpm guard. Run it narrowly with
`bunx vitest run scripts/check-licenses.test.ts` when editing the scanner.

### Security audit and Dependabot

`bun run security:audit` runs `bun audit --audit-level=high` and is part of
`bun run check` and the release workflow. In CI, the GitHub dependency-review
step is conditional on the repository's Advanced Security availability. When
that step is skipped, the bun audit and license allowlist remain the required
dependency checks.

`.github/dependabot.yml` tracks the `github-actions` and `bun` ecosystems weekly.
Minor and patch bun updates are grouped. Major updates are ignored by default,
and TypeScript majors are ignored explicitly. Dependabot alerts are not suppressed
by these ignore rules. The bun ecosystem does not produce security-update pull
requests, so security alerts must be tracked separately.

### CI and release wiring

`.github/workflows/ci.yml` runs each gate as a separate step after installing
Node 24 and `oven-sh/setup-bun`. Extension browser tests need
`bunx playwright install --with-deps chromium` first. The macOS release workflow
(`.github/workflows/release-macos.yml`) uses the same bun setup, installs
Chromium with `bunx playwright install chromium`, and then runs `bun run check`
and `bun run security:audit` before signing.

`.github/workflows/security-scan.yml` is a thin caller of the organization's
reusable security scan (`PSD401/.github/.github/workflows/reusable-security-scan.yml`).
It runs on pull requests, pushes to `main`, a Monday 09:00 UTC schedule, and manual
dispatch. The scan runs gitleaks over the full git history (findings are redacted in
the log) and zizmor, which fails on high-severity workflow issues. Dependency review
runs on pull requests only in public repositories. The caller grants `contents: read`
only and passes no secrets. The reusable workflow is referenced at `@main` on purpose
so central bumps propagate; that reference is marked as an intentional zizmor
exception. The check is advisory until the organization's `psd-standard` ruleset moves
from `evaluate` to `active`.

Focused validation for dependency or tooling changes:

```sh
bun install --frozen-lockfile
bun run licenses:check
bunx vitest run scripts/check-licenses.test.ts
bun run security:audit
```

Running `bun run licenses:check` after a `bun install` is the cheapest proof that
the installed tree satisfies the allowlist. `bun run check` is conditional: run it
when a change affects multiple gates, the workspace graph, or the CI step order.

CI is defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
Detailed evidence is in [`docs/verification.md`](../../docs/verification.md).
Gate ordering and dependency-review behavior are also reflected in the
[release gates](release-gates.md).
