# Private Chrome Web Store submission

This is operator-ready copy for the private PSD-only Chrome Web Store item. Do
not select public or unlisted visibility. Do not enter a personal support
address, publisher address, or legal attestation without district approval.

## Listing

- **Name:** Atrium Capture
- **Summary:** Record, review, redact, and publish private visual guides directly to PSD's Atrium workspace.
- **Category:** Productivity
- **Language:** English (United States)
- **Visibility:** Private — Peninsula School District only
- **Icon:** `apps/browser-extension/public/icons/128.png`

### Detailed description

Atrium Capture helps Peninsula School District staff turn a browser workflow
into a reviewed visual guide.

Start a recording from the side panel, complete a task, and review only the
meaningful steps. Edit instructions, reorder or combine steps, annotate
screenshots, and apply permanent redactions before creating a private Atrium
draft. Internal publication is a separate, explicit action.

Privacy is built into the workflow:

- Password fields are never captured.
- Ordinary typed values are represented as generic intent, not retained text.
- Screenshots remain local until the author reviews them.
- Only flattened, metadata-stripped derivatives can be uploaded.
- Unredacted originals never enter the publishing outbox.
- OAuth tokens stay in the trusted extension worker and never enter page scripts
  or logs.
- The extension has no advertising, analytics, telemetry, or third-party AI
  calls.

Atrium Capture is available only to district-managed users and publishes
directly to the district's AI Studio/Atrium service.

## Single purpose

Record a user-started browser workflow, let the author review and permanently
redact its visual steps, and publish the approved guide directly to Atrium.

## Permission justifications

- **`sidePanel`:** provides the visible recorder, review editor, privacy review,
  and Atrium publishing workflow.
- **`identity`:** performs Authorization Code + PKCE sign-in to the district's AI
  Studio/Atrium public client. Tokens remain in trusted extension storage.
- **`storage`:** reads district-managed policy and keeps trusted extension
  preferences. Capture documents, receipts, images, and outbox jobs use
  IndexedDB.
- **`unlimitedStorage`:** prevents Chrome's generic quota from corrupting a long
  recording. Atrium Capture still enforces the smaller administrator-configured
  step and image-byte limits before persistence.
- **`<all_urls>` host access:** allows a user-started recording to continue
  across approved HTTP(S) origins and permits visible-tab screenshots. The
  content script attaches listeners only while recording and only after
  worker-owned policy allows the origin.
- **Optional `nativeMessaging`:** enabled only from a user gesture for bounded
  semantic enrichment by the Mac companion. The validated bridge rejects
  screenshot bytes, tokens, typed values, and browser URLs.

The extension does not request cookies, browsing-history, geolocation,
clipboard, downloads, or debugger permissions.

## Privacy disclosures

Use conservative disclosure for data the extension processes during a
user-started recording, even when managed policy minimizes or strips it:

- **Website content:** yes — reviewed screenshots and bounded page semantics.
- **User activity:** yes — meaningful clicks, navigation, selection, submit, and
  generic input intent while recording.
- **Web history:** yes — the current recorded origin and, when policy permits,
  page path/title; Atrium Capture does not read Chrome's browsing-history
  database.
- **Authentication information:** yes — OAuth tokens are processed only in the
  trusted extension worker and sent only to AI Studio/Atrium.
- **Personally identifiable information:** potentially present in a screenshot;
  the author must review/redact it before publication. Atrium Capture does not
  extract or profile it.
- **Health, financial/payment, personal communications, and location:** not
  intentionally collected. District policy should deny sensitive origins; if
  such content is incidentally visible, it remains local until mandatory review
  and must be permanently redacted or deleted.

For every declared type:

- used only for Atrium Capture's single purpose;
- never sold;
- never used for advertising, creditworthiness, or unrelated profiling;
- never transferred to an unrelated third party; approved images and document
  content go directly to district AI Studio/Atrium and its district-approved
  storage provider at the author's request.

There is no remote code. All executable JavaScript is packaged in the submitted
Manifest V3 bundle.

## Submission guard

Before selecting **Submit for review**:

1. Confirm the publisher is **Peninsula School District**.
2. Confirm visibility is **Private** and limited to the PSD organization.
3. Confirm the item ID is
   `jldnpmcpimhabiphcglkbgmbffpoocpo`. If it differs, stop; do not submit or
   silently change the production OAuth redirect.
4. Confirm version `1.0.0` and the ZIP SHA-256 match
   `apps/browser-extension/.output/browser-upload-manifest.json`.
5. Use only synthetic screenshots for the listing.
6. Have a district operator confirm the support contact, publisher address,
   trader declaration, and privacy-policy URL.
7. After publication, record the non-secret private-store receipt and run
   `pnpm verify:pilot`.
