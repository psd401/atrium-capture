# Contracts

These JSON Schemas are the cross-platform source of truth.

- `capture-session.schema.json`: local normalized recording and editor state.
- `publish-job.schema.json`: durable, retryable Atrium outbox state.
- `native-bridge.schema.json`: metadata-only Chrome ↔ Mac envelope.

Contract versioning rules:

- Additive optional fields may remain within a schema version.
- Removing, renaming, retyping, or changing semantics requires a new major schema version and a migration.
- Persisted data is validated on read and migrated before use.
- TypeScript and Swift must share the same fixture corpus before either platform ships.
