# Contracts

These JSON Schemas are the cross-platform source of truth.

- `capture-session.schema.json`: local normalized recording and editor state.
- `publish-job.schema.json`: durable, retryable Atrium outbox state.
- `native-bridge.schema.json`: metadata-only Chrome ↔ Mac envelope.
- `guide-suggestion.schema.json`: assistant-written guide text keyed by session step id.

Contract versioning rules:

- Additive optional fields may remain within a schema version.
- Removing, renaming, retyping, or changing semantics requires a new major schema version and a migration.
- Persisted data is validated on read and migrated before use.
- TypeScript and Swift must share the same fixture corpus before either platform ships.

## 1.0 additive history

- 2026-10-14: added optional `Instruction.title`. Backward-compatible: legacy steps omit it and Markdown keeps numbered headings; the district AI guide writer and both editors may set it. Added `guide-suggestion.schema.json` (schema version 1) for assistant replies. The shared browser fixture exercises both in generated TypeScript and Swift models.
- 2026-07-24: added optional `Annotation.arrowDirection`. This is backward-compatible: legacy arrows omit it and render `up_right`; new browser and Mac editors persist all four drag directions. The shared macOS fixture exercises `down_right` in generated TypeScript and Swift models.
- 2026-07-24: added optional `PublishJob.createTitle` and `PublishJob.remoteTitle`. This is backward-compatible: legacy jobs decode without either field. New jobs freeze `createTitle` before the idempotent object-create request, while `remoteTitle` records the last title Atrium confirmed so later user renames can be retried safely without changing an ambiguous create request.
- 2026-07-22: added optional `PublishJob.readerUrl`. This is backward-compatible: queued/legacy jobs omit it, while ready-draft jobs persist the documented reader destination. TypeScript and Swift decode both queued and ready fixtures.
- 2026-07-22: added optional `CaptureSession.policy.rawImageRetention`. This is backward-compatible: older sessions use the safest local default during migration; new managed sessions record whether raw bytes are deleted after flattening or immediately after successful submission.
