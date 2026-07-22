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
pnpm test
pnpm licenses:check
pnpm security:audit
swift test --package-path apps/macos
```

`pnpm contracts:generate` updates both generated TypeScript and Swift models. Never edit either generated file directly. Contract fixtures under `packages/test-fixtures/fixtures` are decoded by both platforms.

The browser fixture site is entirely synthetic. Serve `packages/test-fixtures/site` at `http://127.0.0.1:4173`; no real district information belongs in local fixtures, test recordings, or golden images.

## Local secrets and data

Keep environment files, signing keys, Xcode user state, test recordings, and screenshots untracked. Tests use the local Atrium mock only. A live Atrium integration must remain capability-gated until its documented OAuth and immutable asset contracts are available.
