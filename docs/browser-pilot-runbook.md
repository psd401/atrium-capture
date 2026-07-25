# Browser pilot, support, and rollback runbook

## Engineering pilot decision

The local browser pilot implementation is approved for synthetic/unpublished evaluation on 2026-07-22. This approval covers the extension's privacy boundary, policy enforcement, diagnostics, rollback, and automated acceptance evidence; it is not authorization to deploy to district users or connect to production Atrium.

Checklist:

- [x] Password fields and credential autocomplete tokens are never observed.
- [x] Ordinary typed values are represented as intent and never retained.
- [x] Managed site allow/deny rules are evaluated in the trusted worker and before content listeners attach.
- [x] URL retention strips query/fragment and can be forced to origin-only or none.
- [x] Opaque redaction is flattened into new metadata-free pixels before publication eligibility.
- [x] Raw bytes are excluded from every upload plan and deleted at flatten or successful submit according to policy.
- [x] Storage and step budgets pause safely without dropping acknowledged state.
- [x] Diagnostics export contains counts/capabilities only and is tested against titles, instructions, URLs, IDs, tokens, and image bytes.
- [x] Local deletion removes sessions, images, receipts, commands, and outbox jobs after explicit confirmation.
- [x] Extension-loaded Chromium verifies keyboard focus, recording/restart recovery, review, redaction golden, capability gate, diagnostics download, and permission rationale.
- [x] Rollback and staged update procedures are documented below.
- [ ] Authenticated production-Atrium private draft with synthetic content. Authorization and district login succeed, but production currently rejects the exact extension origin at token exchange; `pnpm smoke:atrium:browser-token` reproduces the external blocker without credentials.

## Pilot installation

1. Build and test the exact source revision with the commands in `development.md`.
2. For engineering evaluation, load `apps/browser-extension/.output/chrome-mv3` unpacked into a dedicated synthetic Chrome profile.
3. For a managed ring, use a district-signed/store-hosted artifact and Chrome `ExtensionSettings`; do not distribute the unpacked directory.
4. Apply a versioned policy from `browser-managed-policy.md`, refresh `chrome://policy`, and export Support diagnostics.
5. Use the bundled production client. Sign in to AI Studio, create one synthetic private draft, verify the reader and explicit internal-publication action, and retain no production screenshots. Set `atriumOAuthClientId` only when deliberately testing a separately approved client. `pnpm acceptance:atrium:browser` performs this operator-attended flow in a disposable visible Playwright Chromium profile using only the committed synthetic fixture; add `ATRIUM_CAPTURE_ACCEPTANCE_PUBLISH_INTERNAL=1` only with explicit approval for the synthetic internal publication.

Before asking an operator to sign in, run `pnpm smoke:atrium` and
`pnpm smoke:atrium:browser-token`. Do not repeat operator login while the second
command reports `invalid_request_origin`; Atrium must permit the exact stable
extension origin for the exact browser client first.

## Permission rationale

- `<all_urls>` is required by Chrome for `captureVisibleTab` across a user-started multi-origin workflow. The content script itself matches only HTTP(S), asks the worker for current policy, and attaches listeners only while recording on an allowed origin.
- `sidePanel` hosts the visible recorder/editor.
- `storage` reads administrator policy; capture state and image blobs use IndexedDB. Managed storage is restricted to trusted extension contexts.
- `unlimitedStorage` prevents Chrome's generic quota from corrupting a long recording. The smaller administrator-controlled `maxStorageBytes` budget is still enforced before image commit.
- `identity` supports Atrium Authorization Code + S256 PKCE. Tokens stay in trusted-only session storage, survive service-worker stops, and are cleared on browser exit or sign-out.

No permission reads cookies, browsing history, page storage, network traffic, password values, or ordinary input values. M6 adds `nativeMessaging` as an optional, user-requested permission only; it is absent from the required install-time allowlist and forwards a strict semantic subset after worker validation and persistence.

## Support procedure

1. Ask the user to open the side panel → Support diagnostics → Export safe diagnostics.
2. The JSON must report `captureContentIncluded: false` and `telemetryEnabled: false`. It contains no title, instruction, URL, selector, session/job/asset ID, reader link, token, or image bytes.
3. Check policy validity, extension version/ID, local image bytes, capture state, outbox phase, retryability code, and capability flags.
4. If policy is invalid, compare only key names/types with the managed policy document; never request screenshots or a user's recorded guide.
5. For a retryable outbox interruption, use Retry safely. Stable idempotency keys prevent duplicate remote state.
6. If live sign-in is unavailable, verify the bundled public client remains active and that the production authorization endpoint returns an actual HTTP redirect. Run the synthetic token-boundary probe; `invalid_request_origin` requires an Atrium server fix, not another employee login, a client UUID, or a substitute host/route.
7. If an asset retry remains blocked behind an expired reservation, record only the fixed error/request ID and follow the limitation in ADR 0006; never collect the image or upload it elsewhere.

## Rollback

1. Set `allowedOrigins` to an empty array with `schemaVersion: 1` to stop new capture immediately while preserving local recovery.
2. Remove the extension from the force-install ring or roll `ExtensionSettings` back to the last approved signed version.
3. Users who must remove local data select Delete all local capture data and confirm the explicit destructive prompt. Extension removal also clears extension-owned storage, but the in-product action provides verifiable immediate cleanup.
4. Refresh `chrome://policy`, restart the pilot profile if required by MDM, and verify the extension no longer records on the synthetic fixture.
5. Preserve only the content-free diagnostic export needed for support; never collect the IndexedDB profile.

## Update rings

Promote an immutable, signed artifact through engineering, support, and pilot rings. At each ring, verify the manifest extension ID/version, SHA-256 digest, policy schema compatibility, automated gates, synthetic fixture workflow, diagnostics export, and rollback. Chrome Enterprise reports that `ExtensionSettings` updates generally apply without restart, but an ongoing recording may retain its original session policy; Atrium Capture always applies a newly stricter restriction immediately.

The v1 packaging and acceptance record is [browser-v1-release.md](browser-v1-release.md).

## Manual accessibility acceptance

- Navigate every control with keyboard only and confirm a visible focus indicator.
- Confirm status changes use the `status` role and policy failures use `alert`.
- Verify all inputs/selects have programmatic labels and screenshot tools expose pressed state.
- At 200% browser zoom and a narrow side panel, confirm controls reflow without horizontal page scrolling; the screenshot editor may scroll within its labeled image region.
- Confirm color is not the only recording/review indicator and text remains readable in Chrome's forced-color/high-contrast mode.
