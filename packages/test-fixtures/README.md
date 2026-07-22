# Test fixtures

Synthetic cross-platform capture sessions, pages, images, and golden outputs live here. Fixtures validate that TypeScript and Swift interpret the same versioned contracts and that redaction/export results remain deterministic.

Never add production or real-person data.

- `fixtures/` contains the shared JSON documents decoded by both TypeScript and Swift.
- `site/` is the synthetic multi-page browser workflow used by extension-loaded tests.
