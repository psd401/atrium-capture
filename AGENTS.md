# AGENTS.md

Guidance for coding agents working in Atrium Capture.

## Mission

Build a browser-first workflow recorder that publishes reviewed visual guides into Atrium and preserves a clean path to a native Mac companion.

## Greenfield and license rule

- The repository is MIT licensed.
- Do not copy source code, tests, assets, prompts, or distinctive UI from Scribe, Snipaste, Mimik, or another product/repository.
- External products may inform requirements and interoperability research only. Implement behavior independently from the contracts and product requirements in this repository.
- Add a dependency only after checking its license and maintenance/security posture.

## Architecture rules

- Treat `contracts/*.schema.json` as the language-neutral source of truth.
- Generate TypeScript and Swift models from contracts when generators are introduced; do not maintain drifting handwritten duplicates.
- Keep normalized capture entities platform-neutral. Browser DOM and macOS Accessibility details belong in their respective optional platform context.
- Browser and Mac clients upload directly to Atrium. Native messaging carries control and semantic metadata only, never screenshot bytes.
- Keep the Atrium API behind a small gateway interface so local capture/editing remains testable while backend gaps are being completed.
- Persist recording state before acknowledging an event. Manifest V3 service workers can stop at any time.

## Privacy and security invariants

- Never read or retain the value of password fields.
- For ordinary typed fields, store an action such as “Enter the requested value,” not the literal value.
- Do not place tokens in content scripts. OAuth and Atrium calls run only in trusted extension/native contexts.
- A screenshot becomes publishable only after redactions are flattened into new pixels and metadata is stripped.
- Never upload the unredacted source image.
- New Atrium objects default to private draft.
- Use synthetic fixtures only. Never commit real student, staff, or production screenshots/data.
- Validate all content-script and native-messaging payloads at trust boundaries.
- No third-party AI calls from capture clients. Any later AI-assisted rewriting must use a district-approved Atrium/AI Studio boundary and explicit policy.

## Quality gates

- Contract changes require backward-compatibility notes and browser + Swift fixture tests.
- Capture/event logic requires unit tests for merging, ordering, restart recovery, and sensitive-field behavior.
- Screenshot editing requires golden tests proving redactions are irreversible in exported/uploaded bytes.
- Browser integration tests use a synthetic local fixture site and a real extension-loaded Chromium profile.
- Mac code requires unit tests around normalized events and manual verification for Screen Recording and Accessibility permission states.
- Do not declare a milestone complete while its listed exit gate is unmet.

## Git workflow

- Use protected `main` with short-lived feature branches and pull requests.
- Keep commits scoped and explain privacy/security implications when applicable.
- Do not create remote repositories, issues, releases, or deployments without explicit user approval.
