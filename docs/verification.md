# Verification record

This file records reproducible local evidence for milestone exit gates. A milestone is listed as complete only after its stated gate passes; planned CI or source inspection alone is not counted as runtime evidence.

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
- `pnpm test:extension`: bundled Chromium loads that production extension and records a synthetic multi-page click/input/select/shortcut/submit/navigation workflow. The test force-stops all service workers, proves recording resumes, confirms acknowledged steps occur exactly once, verifies screenshots persist, and asserts neither the synthetic ordinary input literal nor password literal appears in the stored session.
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
- `AtriumGateway` exposes independent OAuth, collection discovery, immutable asset, idempotency, and publication capabilities. The unavailable live implementation fails closed and contains no production route. The synthetic HTTP implementation accepts only `/_mock/atrium-capture/v1` and validates bounded responses at the client trust boundary.
- Authorization tests prove S256 PKCE state/challenge handling, use the fixed Chrome Identity redirect, keep the verifier out of the authorization URL, validate token responses, and send no token through a runtime message. The manifest requests the documented `identity` permission; live endpoints/scopes remain absent.
- Publisher tests inject a connection loss after remote commit at private-object creation, each asset upload, version creation, and internal publication. Every retry ends with exactly one object, one copy of each asset, and one version; visibility stays private until the separate internal-publication action.
- IndexedDB version 3 stores the durable outbox. A browser-service test closes the repository after a committed-but-unacknowledged object creation, opens a new repository instance, resumes the job, and obtains one private draft and reader link without selecting the retained raw sentinel.
- The side panel provides a collection picker/managed-default indication, phase/error status, safe retry, reader link, and explicit internal-publication action when capabilities exist. The production build instead displays the named capability blocker and confirms no data was sent.
- `pnpm typecheck`, `pnpm contracts:check`, `pnpm messages:check`, package/unit tests, the localhost HTTP integration test, production WXT build, and extension-loaded Chromium workflow pass. Swift 6 decodes the new ready-draft fixture in the official container.
- [ADR 0003](adr/0003-durable-atrium-publication.md) records persistence-before-I/O, idempotency, private-default, raw-asset exclusion, PKCE, and the no-invented-route decision.

Exit-gate conclusion: every publication phase recovers from a post-commit interruption without duplicate remote state and private is the default. Production publication remains exclusively blocked on Atrium's documented OAuth registration/token validation, immutable authored-asset upload, collection discovery or managed default, and idempotent write contract.

## M4 — locally complete (2026-07-22)

- The production manifest packages a Chrome-managed-storage schema for versioned origin allow/deny rules, URL retention, raw-image retention, default collection, image-byte budget, and step budget. The worker restricts managed storage to trusted contexts, validates it again, fails closed on malformed data, and immediately refreshes content listeners on change.
- Recorder tests prove deny-before-allow behavior, trusted-sender URL use, no-URL retention, invalid-policy refusal, and pause-before-commit when a screenshot would exceed the administrator budget.
- The optional additive `CaptureSession.policy.rawImageRetention` field records the applied policy in the shared contract and decodes from the same fixture in generated TypeScript and Swift. `delete_after_submit` tests retain raw bytes locally through review, exclude them from upload, and atomically delete/tombstone them when the private draft succeeds.
- Support diagnostics report only version/platform, policy validity/counts, storage counts, capture counts, capability flags, phase/attempt count, and an error code. Unit and downloaded-export tests prove synthetic titles, instructions, origins, IDs, tokens, and screenshot bytes are absent; telemetry is explicitly off.
- The side panel presents keyboard-focusable controls, status/alert semantics, a permission rationale, a safe diagnostic export, and explicit confirmed deletion of every local capture store. The extension-loaded test downloads and inspects the diagnostic JSON, then exercises the rollback deletion and observes an empty recorder.
- [Managed policy](browser-managed-policy.md) and the [pilot/support/rollback runbook](browser-pilot-runbook.md) record bounds, deployment rings, permissions, privacy/security review, support handling, update behavior, and rollback. The engineering checklist is approved for synthetic/unpublished evaluation.
- The complete local gate passes formatting, lint, strict typechecking, schema/message generation checks, unit/integration tests, production WXT build, extension-loaded Chromium acceptance, Swift fixture decode, license allowlist, and dependency audit.

Exit-gate conclusion: every locally buildable pilot control, privacy review, support diagnostic, and rollback check passes. The sole unavailable pilot action is authenticated development-Atrium publication, which remains blocked on the named Atrium production capabilities rather than an implementation substitute.

## M5 — locally complete (2026-07-22)

- Browser package and manifest versions are `1.0.0`. `pnpm package:browser` builds the production MV3 ZIP, validates required runtime/schema files and the exact reviewed permission set, rejects source/test/fixture/map/environment/key material, and emits an artifact size/SHA-256 manifest with telemetry/live Atrium disabled and signing explicitly false.
- Capture-core classifies merged events before screenshot work. A service test proves a duplicate click captures exactly one image, while the reducer hardening test produces 1,000 ordered unique steps at the managed default ceiling.
- IndexedDB version 4 adds a bounded 100-entry operational health ring. Fixed event codes record worker lifecycle, capture/quota/screenshot health, message failures, and publication readiness/retry/attention without content. Diagnostics export only the latest timestamp/code/severity tuples and never transmits them.
- The production extension test covers keyboard focus, a forced worker stop, multi-page capture, input/password omission, review/redaction, private live-capability gate, safe diagnostics download, permission rationale, and confirmed data deletion. The separate pixel golden remains byte-level.
- CI now generates and verifies the browser package after extension acceptance. [Browser v1 release](browser-v1-release.md) records the supported district matrix, automated commands, manual synthetic ring, signing custody, store checklist, and the rule that signing/upload/deployment require explicit approval.
- Formatting, lint, strict typechecking, schema/message freshness, all unit/integration tests, build, extension acceptance, package verification, Swift shared-contract tests, license allowlist, and a high-severity audit pass.

Exit-gate conclusion: every locally buildable Browser v1 implementation, hardening, package, health, documentation, and automated acceptance gate passes. The artifact is deliberately unsigned and undeployed; those external release actions were not authorized. Live workflow publication remains gated only by the named Atrium contracts.

## M6 — locally complete (2026-07-22)

- The Swift package now builds generated contracts, platform-neutral native core, macOS adapters, SwiftUI app, native host, and acceptance verifier. The actual AppKit/ScreenCaptureKit/Accessibility/AuthenticationServices/Security targets compile and link with the installed macOS 15.4 SDK under Swift 6 strict concurrency.
- The official `swift:6.0-bookworm` suite executes 26 tests across shared fixtures, recorder persistence/restart, duplicate merging, ordering, secure-field rejection, generic input intent, exact bridge validation, serialized screenshots, mandatory sensitive-step redaction, durable publishing, mixed-scale display geometry, pixel sampling, bounded pins, and clipboard retention.
- The shared `capture-session-macos-v1.json` validates against the same schema in AJV and decodes through generated TypeScript and Swift models. A recorder test normalizes synthetic Finder, System Settings, and Office events into one `surface: macos` contract without a value field.
- Accessibility source inspection and tests enforce the value-free boundary: the adapter never asks for `kAXValueAttribute`; secure roles return no name and are rejected before ScreenCaptureKit. Rejected-event receipts survive restart, frames pass through an explicit serialized queue, and merged-event raw files are discarded rather than retained as unreferenced assets.
- Native review uses the same generated crop/annotation/session types. Input and otherwise flagged screenshot steps cannot be flattened, approved, or enqueued without an opaque redaction; mosaic does not satisfy the gate. The Core Graphics release verifier injects a synthetic metadata marker, replaces target pixels with opaque black, preserves neighboring pixels, and proves `tEXt`/`iTXt`/`zTXt`/`eXIf`/`tIME` are absent.
- The native durable publisher persists every phase, accepts only `publishable_local`, defaults to private draft, and recovers lost responses after object, asset, version, and internal-publish commits with exactly one remote result each.
- Native OAuth implements S256 PKCE, `ASWebAuthenticationSession`, an explicitly supplied HTTPS token endpoint, bounded Bearer response validation, and off-main-thread SecItem Keychain writes. Production UI remains capability-gated because Atrium's RFC 8252 and asset/idempotency contracts are absent.
- The optional Chrome bridge requests `nativeMessaging` from a user gesture. Browser tests prove it omits browser URLs, screenshots, typed values, and tokens; the packaged Swift host accepts the shared fixture and rejects nested `imageData`.
- `scripts/build-macos-app.sh` produces and verifies an ad-hoc-signed `Atrium Capture.app` with the native helper embedded. It does not install the host, notarize, upload, or deploy.

Exit-gate conclusion: synthetic Finder/Settings/Office semantics produce the same valid capture document model and private-default publish phases as the browser. Every local M6 build, recovery, privacy, fixture, and packaging gate passes. Live authentication/publication is blocked only by the named external Atrium capabilities.

## M7 — locally complete (2026-07-22)

- The AppKit region selector creates one overlay per active Quartz display, joins all Spaces/full-screen applications, supports reverse-direction drags, displays point dimensions, magnifies the preview without interpolation, and reports an sRGB hex color.
- ScreenCaptureKit selects the display containing the region center and maps a display-local source rectangle to independent X/Y pixel scales. Core tests cover Retina 2× plus an external 1× display with a negative global origin.
- Global `⌥⌘A`/`⌥⌘E`/`⌥⌘P` shortcuts initiate region capture, focused-element capture, and pin visibility. Permission checks gate point-of-use capture; an active recording pauses and removes monitors if Screen Recording or Accessibility changes.
- Pin history is atomically persisted, count/byte bounded, grouped, removable, and restart recoverable; move/resize changes persist with the current display. Malformed persisted bounds fail closed and retention limits are normalized. Real AppKit verifier output asserts the pin is floating, click-through, all-Spaces, and full-screen auxiliary. Clipboard controls support no copy, keep-until-replaced, or owner-aware timed clearing that cannot erase newer clipboard content.
- The SwiftUI editor exposes instruction editing and arrow, rectangle, text, highlight, and opaque-redaction commands, then performs the same flatten/approve/private-draft flow. Pinning accepts reviewed derivatives only.
- The release native verifier, host verifier, parser check, Linux Swift suite, macOS debug/release builds, plist validation, ad-hoc signing verification, formatting/type/schema tests, and documented synthetic physical-device matrix pass their locally automatable checks.
- [ADR 0004](adr/0004-native-runtime-and-overlay-boundaries.md) records native boundaries and [the Mac runbook](macos-runbook.md) records permission, display, Space, full-screen, pin, clipboard, and rollback acceptance.

Exit-gate conclusion: native overlay behavior is implemented and automatically verified across coordinate origins, scale factors, AppKit Space/full-screen policy, permission-driven pause paths, pin recovery, and clipboard ownership. The runbook preserves the physical multi-display and district-signed release matrix; those operator checks do not weaken the local privacy or build gates.
