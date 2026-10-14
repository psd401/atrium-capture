# Feature backlog

Agreed 2026-10-14 with Reese. Order is by expected win. Each item gets its own
spec under `docs/superpowers/specs/` before implementation. When work on a
nearby part of the codebase makes one of these cheap, pick it up in that PR
and note it here.

## 1. AI guide writer (in progress)

Spec: `specs/2026-10-14-ai-guide-writer-design.md`.

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
