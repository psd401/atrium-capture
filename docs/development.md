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
scripts/build-macos-app.sh
```

`pnpm check` runs the combined engineering gate. It deliberately does not claim
that an unsigned browser upload or ad-hoc Mac build is ready for users.
`pnpm verify:pilot` additionally requires a signed, published, private PSD-only
Chrome Web Store receipt matching the exact upload SHA-256 and a stable
Apple-signed Mac app. `pnpm verify:distribution` additionally requires a
Developer ID Application signature accepted by Gatekeeper.

`pnpm contracts:generate` updates both generated TypeScript and Swift models. Never edit either generated file directly. Contract fixtures under `packages/test-fixtures/fixtures` are decoded by both platforms.

`pnpm messages:generate` compiles the extension trust-boundary JSON Schema into a committed standalone validator. Runtime AJV compilation is intentionally forbidden because Manifest V3 disallows dynamic code generation. Install bundled Chromium once with `pnpm --filter @atrium-capture/browser-extension exec playwright install chromium`; the browser suite launches the production MV3 build in a persistent profile and runs the synthetic restart/review workflow plus byte-level image goldens.

The Atrium client integration test binds a loopback-only synthetic server on an ephemeral port. It exposes only `/_mock/atrium-capture/v1`. Production-gateway tests inject documented v1 responses and assert exact private/source/asset/ETag behavior without credentials. Run `pnpm exec vitest run packages/atrium-client/test` for both boundaries. `pnpm smoke:atrium` is an optional read-only network check of production OIDC discovery, the unauthenticated content boundary, and both bundled public-client registrations. It verifies their exact redirects and required scopes without entering sign-in or handling a secret. The documented environment variables may override both bundled UUIDs together when checking separately approved test clients. `pnpm smoke:atrium:browser-token` sends a deliberately invalid synthetic authorization code with the real extension origin; production must reach code validation and return `invalid_grant`.

`pnpm smoke:atrium:browser-content` loads the production extension in headless
Chromium and sends a synthetic invalid bearer token to every content route used
by the gateway. Every route must be reachable from the real service-worker
context and return the bounded `401 INVALID_TOKEN` envelope. This specifically
guards native browser-function receiver behavior that Node-only contract tests
cannot reproduce. Run all three credential-free smokes before asking an
operator to complete production login.

`pnpm package:browser` creates and inspects the unsigned Browser v1 store-upload
ZIP, then writes `browser-upload-manifest.json` under the ignored `.output`
directory. Packaging never signs, uploads, or deploys. Follow
[browser-v1-release.md](browser-v1-release.md) for private PSD-only store
signing and release acceptance.

The browser fixture site is entirely synthetic. Serve `packages/test-fixtures/site` at `http://127.0.0.1:4173`; no real district information belongs in local fixtures, test recordings, or golden images.

The Swift package also includes the native recorder, editor, publisher, bridge, display, and pin tests. On non-macOS hosts, use the official `swift:6.0-bookworm` image for the platform-neutral suite. On macOS, `scripts/build-macos-app.sh` compiles the actual Apple adapters and runs a standalone Core Graphics/AppKit verifier even when a Command Line Tools-only installation does not include a compatible XCTest module. Full Xcode CI runs all XCTest targets. See [macos-runbook.md](macos-runbook.md).

The production manifest packages `public/managed-storage-schema.json`. Validate
policy behavior with
`apps/browser-extension/policy/example-managed-policy.json` and the unit tests;
do not place real district origins, collection identifiers, or credentials in
repository fixtures. The production source contains only the two approved public
OAuth application identifiers; fixture identifiers remain synthetic. Deployment,
support, update, and rollback steps are in
[browser-pilot-runbook.md](browser-pilot-runbook.md).

## Browser permission rationale

Chrome requires the literal `<all_urls>` host permission (or a short-lived `activeTab` grant) for `captureVisibleTab`. Atrium Capture uses `<all_urls>` because a user-started workflow may cross origins and still needs correctly associated screenshots. The content script itself matches only HTTP/HTTPS pages, asks the trusted worker for current policy, and attaches observation listeners only while a session is actively recording and the site is allowed. It never reads cookies, page storage, network traffic, password values, or ordinary typed values. M4 adds administrator allow/deny policy on top of this invariant.

## Local secrets and data

Keep environment files, signing keys, Xcode user state, test recordings,
screenshots, and tokens untracked. Tests use synthetic local or injected
production-contract boundaries. The bundled production OAuth client UUIDs are
public identifiers, not secrets; no client secret belongs in either application.
