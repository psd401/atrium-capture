---
type: Component
title: Browser Recorder and Recovery
description: The extension service worker serializes validated events, screenshots, receipts, and IndexedDB updates before acknowledgement.
tags: [chrome, wxt, manifest-v3, indexeddb, recovery]
---

# Browser Recorder and Recovery

The production extension is built with WXT, React, and TypeScript. Its side
panel starts, pauses, resumes, and stops recording while displaying live steps.

## Trust boundary

The content script observes clicks, input intent, selection, submission,
shortcuts, and navigation on policy-allowed HTTP(S) pages. It never reads
password values or ordinary field values. Every envelope is compiled from
`apps/browser-extension/src/message.schema.json` and validated again in the
trusted service worker.

## Durable event handling

The service worker owns a serialized command queue:

1. Validate the message and sender.
2. Normalize or merge the event.
3. Capture the visible tab through the single screenshot queue when needed.
4. Commit the updated session, asset association, and event receipt together.
5. Acknowledge only after the transaction completes.

Replayed receipts are no-ops, so a forced service-worker stop cannot duplicate
acknowledged steps. Storage budgets pause before an oversized image commit.

## Managed operation

Managed policy controls allowed/denied origins, URL retention, raw-image
retention, default collection, and storage/step budgets. Malformed policy fails
closed. Support diagnostics contain fixed codes and counts only, with telemetry
disabled.

See [`docs/browser-managed-policy.md`](../../docs/browser-managed-policy.md) and
[`docs/browser-pilot-runbook.md`](../../docs/browser-pilot-runbook.md).
