# Browser extension

The browser client is a WXT/React/TypeScript Manifest V3 extension. Its service worker owns recording state, serialized visible-tab screenshots, transactional IndexedDB receipts, and privileged commands. The content script emits only schema-validated, bounded semantic events and never reads field values.

Responsibilities:

- Content script: observe permitted page events and extract bounded semantic context.
- Service worker: owns the capture state machine, screenshots, durable storage/outbox, OAuth, and Atrium gateway.
- Side panel/review: shows recording state and live steps; M2 adds editing and flattened redaction.

Run `pnpm --filter @atrium-capture/browser-extension build` for the production extension and `pnpm test:extension` for the extension-loaded Chromium workflow. Tests use only synthetic fixture pages. Live publication remains disabled until documented Atrium asset and production OAuth capabilities are available.
