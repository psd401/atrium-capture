---
type: Reference
title: Contracts and Shared Fixtures
description: CaptureSession, PublishJob, and native bridge schemas generate TypeScript and Swift models tested against synthetic shared fixtures.
tags: [json-schema, typescript, swift, fixtures, contracts]
---

# Contracts and Shared Fixtures

`contracts/*.schema.json` is the language-neutral source of truth:

- `capture-session.schema.json` defines normalized sessions, steps, assets,
  privacy review, editor commands, and optional platform context.
- `publish-job.schema.json` defines the resumable Atrium outbox.
- `native-bridge.schema.json` defines the metadata-only browser/native bridge.

`scripts/generate-contracts.mjs` deterministically produces
`packages/contracts/src/generated/contracts.ts` and
`apps/macos/Sources/AtriumCaptureContracts/Generated/Contracts.swift`.
Generated files are never edited by hand.

Synthetic fixtures in `packages/test-fixtures/fixtures/` validate and decode in
both languages. Contract changes require backward-compatibility notes and both
test suites. Platform adapters may add optional DOM or Accessibility context but
must not create a second normalized data model.

Run:

```sh
pnpm contracts:check
pnpm test
pnpm swift:test
```
