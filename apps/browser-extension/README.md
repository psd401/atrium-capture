# Browser extension

The browser client is a WXT/React/TypeScript Manifest V3 extension. Its service worker owns recording state, serialized visible-tab screenshots, transactional IndexedDB receipts, and privileged commands. The content script emits only schema-validated, bounded semantic events and never reads field values.

Responsibilities:

- Content script: observe permitted page events and extract bounded semantic context.
- Service worker: owns the capture state machine, screenshots, durable storage/outbox, OAuth, and Atrium gateway.
- Side panel/review: edits, reorders, merges, inserts, crops, annotates, reviews, and flattens steps into publishable PNG derivatives.
- Guide lifecycle: keeps titles editable in every state, safely synchronizes post-create renames to Atrium, preserves older guides/outbox jobs when starting another, and offers a saved-guide picker.
- Managed policy: validates site access, URL/raw retention, the public Atrium client ID, collection fallback, and local byte/step budgets in the trusted worker.
- Support: exports content-free local diagnostics, explains permissions, and can delete all extension-owned capture data after confirmation.
- Mac enrichment: optionally requests Chrome's `nativeMessaging` permission and forwards only validated semantic metadata from the worker to the installed Atrium Capture host.

Run `pnpm --filter @atrium-capture/browser-extension build` for the production extension and `pnpm test:extension` for the extension-loaded Chromium workflow and image goldens. Tests use only synthetic fixture pages and pixels. Live sign-in appears only when managed policy supplies an Atrium-issued public `browser_extension` client UUID.

Run `pnpm package:browser` from the repository root for the verified, unsigned `1.0.0` ZIP and SHA-256 release manifest. Signing and distribution are external approval steps.
