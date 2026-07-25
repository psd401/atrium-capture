# Browser pilot, support, and rollback runbook

## Engineering pilot decision

The browser implementation completed local and authenticated synthetic
production acceptance on 2026-07-25. This approval covers the extension's
privacy boundary, policy enforcement, diagnostics, recovery, rollback, and
production private-draft evidence; it is not authorization to deploy to district
users.

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
- [x] Authenticated production-Atrium private draft with synthetic content.
      The accepted run contains the exact six reviewed instructions, six loaded
      images, the selected title, one current version, and a private authoring
      link.

## Pilot installation

1. Build and test the exact source revision with the commands in `development.md`.
2. For engineering evaluation, load `apps/browser-extension/.output/chrome-mv3` unpacked into a dedicated synthetic Chrome profile.
3. For a managed ring, use a district-signed/store-hosted artifact and Chrome `ExtensionSettings`; do not distribute the unpacked directory.
4. Apply a versioned policy from `browser-managed-policy.md`, refresh `chrome://policy`, and export Support diagnostics.
5. Use the bundled production client. Sign in to AI Studio, create one synthetic
   private draft, verify its title/instructions/images in the private Atrium
   editor and verify the separate internal-publication action remains explicit.
   Retain no production screenshots. Set `atriumOAuthClientId` only when
   deliberately testing a separately approved client.
   `pnpm acceptance:atrium:browser` performs this operator-attended flow in a
   disposable visible Playwright Chromium profile using only the committed
   synthetic fixture; add
   `ATRIUM_CAPTURE_ACCEPTANCE_PUBLISH_INTERNAL=1` only with explicit approval
   for the synthetic internal publication.
6. During review, rename the guide in the side-panel header and verify the new title survives a service-worker restart. Rename it again after a private draft is ready and confirm Atrium receives the new title. The outbox preserves the original create title for ambiguous retries and reconciles the latest title through the documented metadata update.
7. Choose **New guide** while an older durable outbox job exists. Confirm the older guide remains in **Saved guides**, background recovery does not replace the active guide, and either guide can be reopened after a service-worker restart.

Before asking an operator to sign in, run `pnpm smoke:atrium`,
`pnpm smoke:atrium:browser-token`, and
`pnpm smoke:atrium:browser-content`. Do not repeat operator login while any
credential-free gate fails. The third command executes every content route from
the built extension worker and catches browser-only gateway/network defects.

## Permission rationale

- `<all_urls>` is required by Chrome for `captureVisibleTab` across a user-started multi-origin workflow. The content script itself matches only HTTP(S), asks the worker for current policy, and attaches listeners only while recording on an allowed origin.
- `sidePanel` hosts the visible recorder/editor.
- `storage` reads administrator policy; capture state and image blobs use IndexedDB. Managed storage is restricted to trusted extension contexts.
- `unlimitedStorage` prevents Chrome's generic quota from corrupting a long recording. The smaller administrator-controlled `maxStorageBytes` budget is still enforced before image commit.
- `identity` supports Atrium Authorization Code + S256 PKCE. Tokens stay in
  trusted-only extension-local storage, survive browser and service-worker
  restarts on managed devices, and are cleared on sign-out/revocation. Content
  scripts cannot access that storage area.

No permission reads cookies, browsing history, page storage, network traffic, password values, or ordinary input values. M6 adds `nativeMessaging` as an optional, user-requested permission only; it is absent from the required install-time allowlist and forwards a strict semantic subset after worker validation and persistence.

## Support procedure

1. Ask the user to open the side panel → Support diagnostics → Export safe diagnostics.
2. The JSON must report `captureContentIncluded: false` and `telemetryEnabled: false`. It contains no title, instruction, URL, selector, session/job/asset ID, reader link, token, or image bytes.
3. Check policy validity, extension version/ID, local image bytes, capture state, outbox phase, retryability code, and capability flags.
4. If policy is invalid, compare only key names/types with the managed policy document; never request screenshots or a user's recorded guide.
5. For a retryable outbox interruption, use Retry safely. Stable idempotency keys prevent duplicate remote state.
6. If live sign-in is unavailable, verify the bundled public client remains active and that the production authorization endpoint returns an actual HTTP redirect. Run both browser boundary probes before repeating employee login; never substitute a client UUID, proxy, or private host.
7. If an asset retry fails, record only the bounded error/request ID and use
   **Retry safely**. The same per-asset idempotency key must return the same row
   with a fresh upload request. Never collect the image or upload it elsewhere.

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
