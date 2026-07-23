# Development

## Prerequisites

- Node.js 24 or newer and Corepack/pnpm 9.15.2.
- Swift 6 with an SDK from the same Xcode or Command Line Tools release. Native UI milestones require full Xcode.
- District signing, OAuth registration, and Atrium credentials are not required for local capture or mock-gateway tests.

Install exact dependencies with `pnpm install --frozen-lockfile`. The repository-local pnpm store avoids reliance on user-level writable caches.

## Quality gates

Run these from the repository root:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:check
pnpm messages:check
pnpm test
pnpm build
pnpm test:extension
pnpm licenses:check
pnpm security:audit
swift test --package-path apps/macos
```

`pnpm contracts:generate` updates both generated TypeScript and Swift models. Never edit either generated file directly. Contract fixtures under `packages/test-fixtures/fixtures` are decoded by both platforms.

`pnpm messages:generate` compiles the extension trust-boundary JSON Schema into a committed standalone validator. Runtime AJV compilation is intentionally forbidden because Manifest V3 disallows dynamic code generation. Install bundled Chromium once with `pnpm --filter @atrium-capture/browser-extension exec playwright install chromium`; the browser suite launches the production MV3 build in a persistent profile and runs the synthetic restart/review workflow plus byte-level image goldens.

The Atrium client integration test binds a loopback-only synthetic server on an ephemeral port. It exposes only `/_mock/atrium-capture/v1`; the production client has no inferred Atrium route. Run `pnpm exec vitest run packages/atrium-client/test` to verify the mock HTTP boundary and failure-after-commit matrix.

The browser fixture site is entirely synthetic. Serve `packages/test-fixtures/site` at `http://127.0.0.1:4173`; no real district information belongs in local fixtures, test recordings, or golden images.

The production manifest packages `public/managed-storage-schema.json`. Validate policy behavior with `apps/browser-extension/policy/example-managed-policy.json` and the unit tests; do not place real district origins or collection identifiers in repository fixtures. Deployment, support, update, and rollback steps are in [browser-pilot-runbook.md](browser-pilot-runbook.md).

## Browser permission rationale

Chrome requires the literal `<all_urls>` host permission (or a short-lived `activeTab` grant) for `captureVisibleTab`. Atrium Capture uses `<all_urls>` because a user-started workflow may cross origins and still needs correctly associated screenshots. The content script itself matches only HTTP/HTTPS pages, asks the trusted worker for current policy, and attaches observation listeners only while a session is actively recording and the site is allowed. It never reads cookies, page storage, network traffic, password values, or ordinary typed values. M4 adds administrator allow/deny policy on top of this invariant.

## Local secrets and data

Keep environment files, signing keys, Xcode user state, test recordings, and screenshots untracked. Tests use the local Atrium mock only. A live Atrium integration must remain capability-gated until its documented OAuth and immutable asset contracts are available.
