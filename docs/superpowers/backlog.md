# Feature backlog

Agreed 2026-10-14 with Reese. Order is by expected win. Each item gets its own
spec under `docs/superpowers/specs/` before implementation. When work on a
nearby part of the codebase makes one of these cheap, pick it up in that PR
and note it here.

## 1. AI guide writer (in progress)

Spec: `specs/2026-10-14-ai-guide-writer-design.md`. Metadata only in this
iteration.

Follow-up, vision input: Atrium's temporary-attachment staging route accepts
only the NextAuth session cookie and feeds files into repository ingestion.
An aistudio change is needed before a bearer client can hand screenshots to
the assistant as vision input: either bearer support plus a vision purpose on
that route, or an image input on `POST /api/v1/assistants/{id}/execute`.
After that, the client adds a staging step before execute and reuses the
flattened `publishable_local` derivatives.

Follow-up, suggestion summary: store the suggestion summary as
`session.summary` once the capture-session contract gains that field. The
guide-writer assistant already returns and validates it on both platforms.
Only persistence is missing.

Follow-up, deferred test gaps: a Playwright run that presses "Write with AI"
and checks the applied title and step text is still missing. It needs
managed-policy injection and a mock-gateway switch in the browser extension
test harness, neither of which exists yet. A Mac XCTest for the workspace
gating state (`guideWriterAvailable`, `canWriteGuideWithAI`) is also missing.
It needs a test target for the `AtriumCaptureMacApp` executable target, which
does not exist today. `canApplyResult` is covered as a pure function in
`AtriumCaptureCore` instead.

## 2. Snipaste parity on Mac

Milestone M7 already has region capture, magnifier, hex color readout, global
shortcuts, pins with click-through, pin groups, and persisted history. Missing:

- Paste anything as a pin: image, image file, plain text, HTML, color value.
- Pin transforms: zoom, rotate, flip, opacity, thumbnail mode, hide/show.
- Inline annotation on a pin: rectangle, ellipse, polyline, arrow, pencil,
  marker, text, mosaic, blur, eraser, undo/redo.
- History playback for recent captures.
- Auto-detect UI element bounds during region selection (Accessibility).

Touches: `apps/macos/Sources/AtriumCaptureCore/PinBoard.swift`,
`AtriumCaptureMacPlatform/PinsAndShortcuts.swift`,
`RegionSelectionOverlay.swift`, `CoreGraphicsReviewRenderer.swift`.

## 3. Export formats

Markdown exists. Add per-guide GIF and MP4, PDF, and docx, generated from the
same flattened publishable images. Lives in `packages/editor-model` plus a new
renderer package; both clients expose a save dialog.

## 4. Guides as data

Publish targets beyond an Atrium draft: Freshservice knowledge base article,
Atlas process (one capture step maps to one Atlas step), district SOP
template. Each target is a new `AtriumGateway`-style interface behind the
same durable outbox pattern.

## 5. Capture as automation

Export a browser recording as a Playwright script or n8n workflow using the
stored selectors, and expose published guides over MCP so agents can read or
replay them. Browser only at first.

## 6. Ambient capture

User-enabled per-app allowlist mode that records locally without start/stop
and proposes guides for review, with deduplication against existing Atrium
guides. Explicit opt-in, local only, nothing leaves the device before review.
Depends on 1 and 4. Needs a district privacy decision before a spec is
written.

## Non-code blockers (owner: Kris or Atrium admin)

- Browser OAuth: register the authoritative Chrome Web Store callback and
  `chrome-extension://` origin at Atrium (July 26 mismatch).
- Mac: Developer ID signing credentials and MDM ring acceptance.
- Item 1: create the Capture Guide Writer assistant and add the execute scope
  to both client allowlists.
