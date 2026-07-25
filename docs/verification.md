# Verification record

This file records reproducible local evidence for milestone exit gates. A milestone is listed as complete only after its stated gate passes; planned CI or source inspection alone is not counted as runtime evidence.

## Production Atrium publishing update — locally complete, external browser token blocker (2026-07-24)

- Audited current AI Studio `dev` merge `d4d6fb87`; its OIDC, content, collection, capture provenance, authored-asset, version, and publication contracts remain behind the same gateway boundary. No AI Studio source or production asset was copied.
- `pnpm smoke:atrium` verifies the deployed issuer, authorization/token/revocation endpoints, S256, required content scopes, both bundled public-client registrations, and a structured fail-closed `401` from production collection discovery without sending a credential or capture. Each exact callback/scope request must produce a real HTTP 3xx authorization redirect without completing sign-in or printing the IDs. The two documented environment variables override both bundled IDs together only for separately approved test clients.
- `pnpm smoke:atrium:browser-token` sends an intentionally invalid synthetic code with the exact stable extension origin. Production currently returns bounded evidence `invalid_request_origin` instead of reaching code validation and returning `invalid_grant`. No authorization, credential, capture, or token is involved.
- The production native app completed district login, returned through `org.psd401.atrium-capture:/oauth/callback`, exchanged the code, persisted the token set in Keychain, displayed `Atrium Signed In` / `Connected to Atrium`, and remained running. The first callback exposed a Swift actor-isolation trap because AuthenticationServices completed on Safari's XPC queue; the callback bridge is now nonisolated and a background-queue regression test passes.

## Registered-client acceptance

On 2026-07-24, production client registration succeeded for the exact browser
and native callbacks, public PKCE, and all seven required OIDC/content scopes.
The original `invalid_scope` failure and later response-adapter HTTP 200 failure
were resolved by the production updates. District login and exact first-party
no-consent behavior also complete. The strict preflight now exercises both bundled
public clients by default:

```sh
pnpm smoke:atrium
```

It returns:

```json
{
  "contentBoundary": "documented_unauthenticated_401",
  "issuer": "https://aistudio.psd401.ai",
  "oauth": "authorization_code_s256_refresh",
  "registeredClients": ["browser_extension", "native"],
  "status": "pass"
}
```

For an operator-attended production acceptance using only the committed synthetic
fixture, build the extension and run it in a fresh visible Playwright Chromium
profile:

```sh
pnpm --filter @atrium-capture/browser-extension build
pnpm acceptance:atrium:browser
```

The runner automates recording, typed-value/password exclusion checks, privacy
review, irreversible redaction preparation, and private-draft creation. It pauses
only for district AI Studio login and prints no OAuth URL, code, token, typed
value, image, collection name, or content identifier. Set
`ATRIUM_CAPTURE_ACCEPTANCE_PUBLISH_INTERNAL=1` only when the operator has
explicitly approved publishing the synthetic guide internally. An alternate
Chromium executable may be supplied through
`ATRIUM_CAPTURE_ACCEPTANCE_BROWSER_PATH`, but Chrome's registered
`chromiumapp.org` identity callback—not cross-browser identity compatibility—is
the release gate.

The production first-party interaction must show only district login when no
valid AI Studio session exists, then return automatically to Atrium Capture.
Employees never configure a client ID, secret, callback, scope, or consent
decision. The operator-attended private-draft acceptance records the remaining
runtime evidence for that interaction without weakening third-party consent.

The 2026-07-24 live extension run reached the callback and received an
authorization code, then failed closed at token exchange with
`OAUTH-INVALID-REQUEST`. A synthetic no-login probe isolated the reason:
Atrium rejects the exact
`chrome-extension://jldnpmcpimhabiphcglkbgmbffpoocpo` request origin before
authorization-code validation. The extension stored no token, created no draft,
and uploaded no bytes. The client now includes Atrium's issuer as the RFC 8707
resource indicator on both browser and Mac authorization requests; TypeScript
and Swift tests cover that configuration, but it does not replace the required
server CORS decision.

- The TypeScript production gateway contract tests verify private bodyless creation, capture `sourceRef`, selectable collection filtering, deterministic ready/pending asset recovery, recovery after an ambiguous direct-S3 response, rejection of non-AWS upload hosts before image bytes are sent, direct S3 upload without an Atrium bearer header, canonical asset Markdown, `If-Match` preconditions, reader URL, and explicit intranet publication.
- Browser OAuth tests verify the immutable `/atrium` callback, code exchange, trusted-only token persistence, one refresh across concurrent callers, refresh rotation, revocation, malformed-store rejection, and token rejection at the runtime-message boundary. Publication commands are serialized before remote I/O.
- The Mac production gateway compiles under Swift 6 strict concurrency. Its on-host release verifier and macOS-only contract tests inject the same production-shaped sequence and exact header assertions; the portable Swift suite continues to cover durable phase recovery and shared fixtures. Native OAuth now includes the documented callback, strict stored-token validation, Keychain storage, refresh rotation, revocation, and a nonisolated AuthenticationServices completion bridge.
- Browser startup recovery revisits durable terminal drafts to finish local raw-data deletion/session submission. The native publisher orders that cleanup before its terminal job commit and restores ready/complete jobs into the UI after restart without repeating remote writes. A native test keeps a synthetic raw sentinel under `delete_after_submit`, uploads exactly one derivative, deletes the sentinel after the draft commit, and persists `submitted`.
- The only remaining production durability limitation is Atrium's non-idempotent asset-initiation route. A lost initiation response can leave an expired reservation row; clients fail safely and never upload raw bytes or invent a host. ADR 0006 contains reproducible evidence and the required server-side remedy.
- Browser authenticated production acceptance is blocked only by Atrium's exact-client token CORS policy. The approved public UUID is bundled, the strict authorization preflight passes, employees configure nothing, and the separate synthetic token-boundary probe reproduces the external failure.

## M0 — complete (2026-07-22)

- `pnpm contracts:check`: all three Draft 2020-12 schemas compile with strict AJV settings and the shared capture-session, native-bridge, and publish-job fixtures validate.
- `pnpm test`: TypeScript tests load the generated contract types, verify metadata-only bridge content, and prove the input fixture contains intent rather than a typed value.
- `swift test --package-path apps/macos` in the official `swift:6.0-bookworm` environment: Swift 6 compiles the generated models and all three XCTest fixture decodes pass (3 tests, 0 failures).
- `swiftc -frontend -parse`: the installed Apple Swift 6.3.3 parser accepts generated and test sources. Direct local XCTest execution is unavailable on this workstation because Command Line Tools contains a 6.3.3 compiler with a 6.3.2 SDK and no full Xcode; the container supplies independent compile/decode evidence rather than weakening the gate.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, generation freshness, and `git diff --check` pass.
- `pnpm licenses:check` accepts only the reviewed license groups. `pnpm security:audit` reports no known vulnerabilities.
- Synthetic fixture site, threat model, immutable platform identifiers, OAuth registration plan, dependency review, and CI workflows are committed.

Exit-gate conclusion: the identical `capture-session-v1.json` fixture validates in TypeScript and decodes through generated Swift `Codable` models. Platform code has no second handwritten contract model.

## M1 — complete (2026-07-22)

- `pnpm test`: capture-core tests cover state transitions, event ordering, duplicate merging, input-intent generation, and serialization; privacy tests prove password classification never reads a value and sensitive autocomplete tokens are denied; IndexedDB tests prove acknowledged-event replay is idempotent after repository restart.
- `pnpm messages:check`: the content-script message schema is compiled ahead of time into a deterministic standalone validator. The production worker contains no runtime AJV compiler or CSP-forbidden dynamic code generation.
- `pnpm build`: WXT produces a Chrome Manifest V3 extension with a fixed extension ID, service worker, HTTP/HTTPS content script, and React side panel.
- `pnpm test:extension`: bundled Chromium loads that production extension at its 420-pixel side-panel width and records a synthetic multi-page click/input/select/shortcut/submit/navigation workflow. The test force-stops all service workers, reloads the panel, proves recording resumes without horizontal overflow, confirms acknowledged steps occur exactly once, verifies screenshots persist, and asserts neither the synthetic ordinary input literal nor password literal appears in the stored session.
- The service worker owns and serializes commands, screenshots, IndexedDB transactions, and receipts. An event is acknowledged only after its session revision, screenshot association, and receipt commit together.
- The side panel exposes start, pause, resume, stop, live steps, recording state, and a persistent typed-value/password privacy notice. `<all_urls>` is limited to Chrome's cross-origin `captureVisibleTab` requirement; observation remains user-started and policy/state gated.

Exit-gate conclusion: the production extension-loaded workflow survives a forced MV3 worker stop without losing or duplicating acknowledged steps, and sensitive-field/value tests pass at unit and browser-integration layers.

## M2 — complete (2026-07-22)

- Editor-model tests cover instruction edits, reorder, delete, adjacent merge, manual insertion, crop, annotation mutation, automated input-region scaling, review state, and approval gating. Mosaic does not satisfy a flagged secret; only a covering opaque redaction does.
- IndexedDB/editor-service tests prove command replay is idempotent across repository restart, version-one databases migrate without losing recorder state, and finalization atomically stores a publishable derivative, tombstones/deletes the raw asset, replaces the step reference, and advances the reviewed session.
- The production side panel exposes crop, zoom, arrow, rectangle, text, highlight, blur, mosaic, redaction, instruction editing, insertion, reorder, merge, delete, per-step approval, automated sensitive-region suggestions, and a mandatory all-step privacy gate.
- `pnpm test:extension` exercises the real side-panel review flow after the forced worker restart: it applies a suggested opaque redaction to every screenshot-bearing input step, approves every clear step, finalizes images, observes only publishable/deleted asset states, and confirms raw source bytes were deleted.
- The browser image golden injects a synthetic PNG `tEXt` metadata marker, renders crop and all annotation classes, places opaque redaction last, re-encodes PNG, and decodes the output. All 12 covered pixels equal `[17, 24, 39, 255]`; the source marker and `tEXt`/`iTXt`/`zTXt`/`eXIf`/`tIME` chunks are absent.
- [ADR 0002](adr/0002-flattening-and-raw-retention.md) records the irreversible image boundary and safest-default `delete_after_flatten` retention policy.

Exit-gate conclusion: golden and lifecycle tests prove redacted source pixels and source metadata are not recoverable from exported or locally publishable bytes, and unreviewed/raw assets cannot cross the publishable boundary.

## M3 — locally complete (2026-07-22)

- The language-neutral publish-job contract has a backward-compatible optional `readerUrl`; strict schema validation and the generated TypeScript and Swift models decode both queued and ready-draft shared fixtures.
- `AtriumGateway` exposes independent OAuth, collection discovery, immutable asset, idempotency, and publication capabilities. The original unavailable implementation failed closed; the synthetic HTTP implementation accepts only `/_mock/atrium-capture/v1` and validates bounded responses at the client trust boundary.
- Authorization tests prove S256 PKCE state/challenge handling, use the fixed Chrome Identity redirect, keep the verifier out of the authorization URL, validate token responses, and send no token through a runtime message. The original unavailable boundary has since been superseded by the production update above.
- Publisher tests inject a connection loss after remote commit at private-object creation, each asset upload, version creation, and internal publication. Every retry ends with exactly one object, one copy of each asset, and one version; visibility stays private until the separate internal-publication action.
- IndexedDB version 3 stores the durable outbox. A browser-service test closes the repository after a committed-but-unacknowledged object creation, opens a new repository instance, resumes the job, and obtains one private draft and reader link without selecting the retained raw sentinel.
- The side panel provides contextual next-step guidance, a collection picker/managed-default indication, phase/error status, safe retry, reader link, and explicit internal-publication action. It exposes **Sign in to AI Studio** from the trusted extension context using the bundled production public client ID; managed policy can only override it for approved testing.
- `pnpm typecheck`, `pnpm contracts:check`, `pnpm messages:check`, package/unit tests, the localhost HTTP integration test, production WXT build, and extension-loaded Chromium workflow pass. Swift 6 decodes the new ready-draft fixture in the official container.
- [ADR 0003](adr/0003-durable-atrium-publication.md) records persistence-before-I/O, idempotency, private-default, raw-asset exclusion, PKCE, and the no-invented-route decision.

Exit-gate conclusion: every locally mockable publication phase recovers from a post-commit interruption without duplicate remote state and private is the default. The production routes, redirects, first-party login, and bundled clients are implemented; Atrium's exact browser-origin token CORS decision and the non-idempotent asset-initiation interval are the remaining external gates.

## M4 — locally complete (2026-07-22)

- The production manifest packages a Chrome-managed-storage schema for versioned origin allow/deny rules, URL retention, raw-image retention, default collection, image-byte budget, and step budget. The worker restricts managed storage to trusted contexts, validates it again, fails closed on malformed data, and immediately refreshes content listeners on change.
- Recorder tests prove deny-before-allow behavior, trusted-sender URL use, no-URL retention, invalid-policy refusal, and pause-before-commit when a screenshot would exceed the administrator budget.
- The optional additive `CaptureSession.policy.rawImageRetention` field records the applied policy in the shared contract and decodes from the same fixture in generated TypeScript and Swift. `delete_after_submit` tests retain raw bytes locally through review, exclude them from upload, and atomically delete/tombstone them when the private draft succeeds.
- Support diagnostics report only version/platform, policy validity/counts, storage counts, capture counts, capability flags, phase/attempt count, and an error code. Unit and downloaded-export tests prove synthetic titles, instructions, origins, IDs, tokens, and screenshot bytes are absent; telemetry is explicitly off.
- The side panel presents keyboard-focusable controls, status/alert semantics, a permission rationale, a safe diagnostic export, and explicit confirmed deletion of every local capture store. The extension-loaded test downloads and inspects the diagnostic JSON, then exercises the rollback deletion and observes an empty recorder.
- [Managed policy](browser-managed-policy.md) and the [pilot/support/rollback runbook](browser-pilot-runbook.md) record bounds, deployment rings, permissions, privacy/security review, support handling, update behavior, and rollback. The engineering checklist is approved for synthetic/unpublished evaluation.
- The complete local gate passes formatting, lint, strict typechecking, schema/message generation checks, unit/integration tests, production WXT build, extension-loaded Chromium acceptance, Swift fixture decode, license allowlist, and dependency audit.

Exit-gate conclusion: every locally buildable pilot control, privacy review, support diagnostic, and rollback check passes. Authenticated browser production acceptance is blocked only by Atrium rejecting the exact stable extension origin at the token endpoint.

## M5 — locally complete (2026-07-22)

- Browser package and manifest versions are `1.0.0`. `pnpm package:browser` builds the production MV3 ZIP, validates required runtime/schema files and the exact reviewed permission set, rejects source/test/fixture/map/environment/key material, and emits an artifact size/SHA-256 manifest with telemetry disabled, bundled public-client Atrium configuration, and signing explicitly false.
- Capture-core classifies merged events before screenshot work. A service test proves a duplicate click captures exactly one image, while the reducer hardening test produces 1,000 ordered unique steps at the managed default ceiling.
- IndexedDB version 4 adds a bounded 100-entry operational health ring. Fixed event codes record worker lifecycle, capture/quota/screenshot health, message failures, and publication readiness/retry/attention without content. Diagnostics export only the latest timestamp/code/severity tuples and never transmits them.
- The production extension test covers keyboard focus, a forced worker stop, multi-page capture, input/password omission, review/redaction, private live-capability gate, safe diagnostics download, permission rationale, and confirmed data deletion. The separate pixel golden remains byte-level.
- CI now generates and verifies the browser package after extension acceptance. [Browser v1 release](browser-v1-release.md) records the supported district matrix, automated commands, manual synthetic ring, signing custody, store checklist, and the rule that signing/upload/deployment require explicit approval.
- Formatting, lint, strict typechecking, schema/message freshness, all unit/integration tests, build, extension acceptance, package verification, Swift shared-contract tests, license allowlist, and a high-severity audit pass.

Exit-gate conclusion: every locally buildable Browser v1 implementation, hardening, package, health, documentation, and automated acceptance gate passes. The artifact is deliberately unsigned and undeployed; those external release actions were not authorized. Live workflow publication remains gated only by the named Atrium contracts.

## M6 — locally complete (2026-07-22)

- The Swift package now builds generated contracts, platform-neutral native core, macOS adapters, SwiftUI app, native host, and acceptance verifier. The actual AppKit/ScreenCaptureKit/Accessibility/AuthenticationServices/Security targets compile and link with the installed macOS 15.4 SDK under Swift 6 strict concurrency.
- The Swift suite executes 42 tests on macOS across shared fixtures, recorder persistence/restart, duplicate merging, ordering, secure-field rejection, generic input intent, exact bridge validation, serialized screenshots, mandatory sensitive-step redaction, durable publishing, file-backed outbox restart/raw-byte cleanup, terminal-outbox restoration, bounded production request-ID diagnostics, mixed-scale display geometry, pixel sampling, bounded pins, clipboard retention, production gateway configuration, sequential TCC prompting, interactive annotation placement, every renderer tool, four arrow directions, and the off-main AuthenticationServices callback.
- The shared `capture-session-macos-v1.json` validates against the same schema in AJV and decodes through generated TypeScript and Swift models. A recorder test normalizes synthetic Finder, System Settings, and Office events into one `surface: macos` contract without a value field.
- Accessibility source inspection and tests enforce the value-free boundary: the adapter never asks for `kAXValueAttribute`; secure roles return no name and are rejected before ScreenCaptureKit. Rejected-event receipts survive restart, frames pass through an explicit serialized queue, and merged-event raw files are discarded rather than retained as unreferenced assets.
- Native review uses the same generated crop/annotation/session types and renders each local screenshot directly in its step card. A live signed-app capture persisted 1512×982 PNG assets and the rebuilt review workspace exposed lazy-loaded 645×419 previews. The signed editor was then exercised with redaction, blur, mosaic, highlight, rectangle, arrow, text, crop, and undo. Tools use drag-to-place image coordinates, previews run through the production renderer, **Undo** remains beside **Done**, and arrows retain all four drag directions through the backward-compatible optional `arrowDirection` contract field. Input and otherwise flagged screenshot steps cannot be flattened, approved, or enqueued without an opaque redaction; mosaic does not satisfy the gate. The Core Graphics release verifier injects a synthetic metadata marker, replaces target pixels with opaque black, preserves neighboring pixels, and proves `tEXt`/`iTXt`/`zTXt`/`eXIf`/`tIME` are absent.
- The native durable publisher persists every phase, accepts only `publishable_local`, defaults to private draft, and recovers lost responses after object, asset, version, and internal-publish commits with exactly one remote result each.
- Authenticated production acceptance reached bodyless private-object creation on 2026-07-24, but Atrium returned retryable `INTERNAL_ERROR` after the title became visible and before the client received its object ID. The persisted native outbox remained at `creating_object`, proving that no image upload or version request ran. The Mac client now preserves bounded Atrium request IDs, treats `IDEMPOTENCY_IN_PROGRESS` as retryable, exposes phase-specific guidance, and retries only with the same durable job. Completing this live gate requires the external Atrium service to reconcile/replay the ambiguous committed create.
- Native OAuth implements S256 PKCE, `ASWebAuthenticationSession`, the documented HTTPS token/revocation endpoints, bounded Bearer response validation, refresh rotation, and off-main-thread SecItem Keychain access. The production public client UUID is bundled, and the UI guides employees from capture access through **Sign in to AI Studio** without exposing deployment configuration.
- The optional Chrome bridge requests `nativeMessaging` from a user gesture. Browser tests prove it omits browser URLs, screenshots, typed values, and tokens; the packaged Swift host accepts the shared fixture and rejects nested `imageData`.
- `scripts/build-macos-app.sh` produces and verifies an ad-hoc-signed `Atrium Capture.app` with the native helper embedded. It does not install the host, notarize, upload, or deploy.

Exit-gate conclusion: synthetic Finder/Settings/Office semantics produce the same valid capture document model and private-default publish phases as the browser. Every local M6 build, recovery, privacy, fixture, and packaging gate passes; native production authentication and both capture permissions are live verified on an Apple Development-signed build. Private-draft acceptance remains separate from the browser-origin CORS blocker.

## M7 — locally complete (2026-07-22)

- The AppKit region selector creates one overlay per active Quartz display, joins all Spaces/full-screen applications, supports reverse-direction drags, displays point dimensions, magnifies the preview without interpolation, and reports an sRGB hex color.
- ScreenCaptureKit selects the display containing the region center and maps a display-local source rectangle to independent X/Y pixel scales. Core tests cover Retina 2× plus an external 1× display with a negative global origin.
- Global `⌥⌘A`/`⌥⌘E`/`⌥⌘P` shortcuts initiate region capture, focused-element capture, and pin visibility. Permission checks gate point-of-use capture; an active recording pauses and removes monitors if Screen Recording or Accessibility changes.
- Pin history is atomically persisted, count/byte bounded, grouped, removable, and restart recoverable; move/resize changes persist with the current display. Malformed persisted bounds fail closed and retention limits are normalized. Real AppKit verifier output asserts the pin is floating, click-through, all-Spaces, and full-screen auxiliary. Clipboard controls support no copy, keep-until-replaced, or owner-aware timed clearing that cannot erase newer clipboard content.
- The SwiftUI editor exposes drag-to-place arrow, rectangle, text, highlight, blur, mosaic, and opaque-redaction commands; accurate crop/annotation previews; immediate undo; and the same flatten/approve/private-draft flow. Pinning accepts reviewed derivatives only.
- The release native verifier, host verifier, parser check, Linux Swift suite, macOS debug/release builds, plist validation, ad-hoc signing verification, formatting/type/schema tests, and documented synthetic physical-device matrix pass their locally automatable checks.
- [ADR 0004](adr/0004-native-runtime-and-overlay-boundaries.md) records native boundaries and [the Mac runbook](macos-runbook.md) records permission, display, Space, full-screen, pin, clipboard, and rollback acceptance.

Exit-gate conclusion: native overlay behavior is implemented and automatically verified across coordinate origins, scale factors, AppKit Space/full-screen policy, permission-driven pause paths, pin recovery, and clipboard ownership. The runbook preserves the physical multi-display and district-signed release matrix; those operator checks do not weaken the local privacy or build gates.

## Atrium visual alignment follow-up — complete (2026-07-24)

- The current Atrium product was used as a transient visual reference for color, density, radii, and hierarchy only. No production screenshot, content, font, icon pack, or frontend asset was added to the repository.
- The extension side panel renders its 420-point-wide empty state without horizontal overflow. Visual inspection confirms the brand lockup, private-default message, recorder action, step card, diagnostics, permission rationale, and typed-value/password notice remain legible in the side-panel hierarchy.
- Browser semantic tokens use evergreen primary actions, mint review/selection states, warm neutral canvas, white panels, amber warnings, and restrained destructive red. The small-text muted role measures 5.01:1 against white; evergreen primary actions measure 12.40:1 with white text.
- The Mac app uses equivalent native SwiftUI color roles and reusable button, panel, brand, status-pill, and section-label components. Its recorder, quick capture, review, private-draft capability gate, pins, and step editor remain platform-native rather than reproducing the Atrium content-library layout.
- Region and element quick captures now append to the current unpublished guide instead of replacing it. The normalized session plus both receipts recover after restart; manual steps can reopen a prepared guide for privacy review; and editable guide titles are persisted in both clients. Once an Atrium outbox job exists, title/content controls lock to preserve the exact idempotent request.
- The native app exposes the same capture model through a SwiftUI menu-bar extra and single workspace window. Region/element capture, recording control, workspace activation, and explicit `SMAppService` start-at-login control require no daemon, screenshot IPC, or second state owner.
- The ad-hoc-signed Mac bundle was launched with `CFFIXED_USER_HOME` pointed at an empty synthetic temporary root. A target-window-only Core Graphics capture verified its 1080×720 empty workspace, private-default hierarchy, permission card, recorder controls, and no-step state without reading the real Application Support store or the rest of the desktop. The rebuilt UI requests Screen Recording and Accessibility sequentially, links directly to both privacy panes, hides the entire permission card after both grants, shows contextual review guidance, and exposes **Sign in to AI Studio** using the bundled public client.
- The original Mac app icon was generated without an input image, production asset, third-party logo, font, or trademark. Its transparent 1024×1024 master remains recognizable at the 16-point Retina representation; the derived `.icns` is declared by `CFBundleIconFile`, copied into the bundle, and covered by a fail-closed build check.
- `pnpm check` passes formatting, OpenWiki normalization, lint, strict typechecking, generated contract/message freshness, five shared fixture validations, 91 TypeScript tests, production builds, the real extension worker/panel restart workflow, the irreversible redaction golden, extension packaging, 44 Swift tests, and the dependency-license allowlist.
- `scripts/build-macos-app.sh` compiles the production SwiftUI workspace, runs the native redaction, production-gateway, pin, and bridge verifiers, validates the plist, produces the app bundle, and verifies its ad-hoc signature. `pnpm security:audit` reports no known vulnerabilities.
- GitHub CI and the automatic Claude review pass on PR #11. The review reported no code findings; its sole workflow annotation identified the deprecated Node 20-based checkout v4 action, so every workflow now pins the verified official checkout v7.0.1 commit.
- [ADR 0005](adr/0005-atrium-aligned-visual-language.md) records the cross-platform presentation roles, privacy hierarchy, accessibility requirements, and no-production-asset boundary.

Follow-up conclusion: Atrium Capture now reads as a related Atrium tool while preserving its independent recorder/review information architecture, platform conventions, and every existing privacy boundary.
