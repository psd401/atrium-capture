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

`ManagedPolicyProvider.load()` reads the managed storage area and passes it to
`parseManagedPolicy()` in `apps/browser-extension/src/managed-policy.ts`. The
recorder service starts from `parseManagedPolicy({})` (see
`apps/browser-extension/src/recorder-service.ts`), so an unmanaged install gets
the local defaults. The parsed snapshot feeds the site-access checks in the
[privacy model](../privacy/security-and-privacy.md); deny entries are checked
before allow entries there.

Invariants the parser enforces:

- An empty managed object is valid and unconfigured: `delete_after_flatten`,
  `origin` URL retention, a 512 MiB storage budget, 1,000 steps, and no allowed
  origin list.
- A configured policy must set `schemaVersion: 1`. Unknown keys, invalid enums,
  out-of-range budgets (storage 16 MiB–4 GiB; steps 10–10,000), and invalid
  origin patterns mark the snapshot invalid.
- An invalid snapshot fails closed: `allowedOrigins` becomes `[]`,
  `sourceUrlRetention` becomes `none`, and the issue codes (for example
  `unknown_key:<key>`, `schema_version_invalid`) are recorded.
- Origins must be bare `http:`/`https:` origins with no path, query, hash, or
  credentials. Wildcards are only `*.host` patterns. Lists are capped at 1,000.
- A storage read failure yields an invalid policy with
  `managed_storage_unavailable`.

Focused tests are in `apps/browser-extension/test/managed-policy.test.ts`, in the
`managed policy boundary` suite: "uses privacy-preserving defaults for an
unmanaged installation", "normalizes a complete managed policy and preserves deny
precedence", "fails closed when a configured policy is malformed or has unknown
keys", and "fails closed when managed storage cannot be read". Recorder behavior
under a managed policy is also exercised in
`apps/browser-extension/test/recorder-service.test.ts`.

Validate narrowly with `bunx vitest run apps/browser-extension/test/managed-policy.test.ts`.
Operator-facing key names and bounds are documented in
`docs/browser-managed-policy.md`; keep that document consistent with the parser
when a key or bound changes.

See [`docs/browser-managed-policy.md`](../../docs/browser-managed-policy.md) and
[`docs/browser-pilot-runbook.md`](../../docs/browser-pilot-runbook.md).
