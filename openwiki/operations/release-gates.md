---
type: Guide
title: Release Gates and External Dependencies
description: Engineering-complete milestones, fail-closed release artifacts, operational approvals, and remaining signed-distribution gates.
tags: [release, milestones, browser, macos, blockers]
---

# Release Gates and External Dependencies

M0-M3 and M6 meet their exit gates. M4, M5, and M7 have complete locally
automatable engineering work but remain open until the district pilot, signed
distribution, and physical-device matrices pass. The browser ZIP is explicitly
a Chrome Web Store upload, not a signed release. The current local Mac pilot is
Apple Development-signed and installed with a stable identity.

## Locally verified

- Shared TypeScript/Swift contracts and fixtures
- Browser recording, worker restart recovery, editing, and irreversible redaction
- Durable private-default publication against local and production-contract gateways
- Managed browser policy, safe diagnostics, data deletion, and rollback
- Native recording, permission degradation, region capture, pins, and mixed-display geometry
- Dependency license allowlist and high-severity audit

## External or operator gates

- Private PSD-only Chrome Web Store signing and managed-ring distribution
- Apple distribution signing, notarization, MDM packaging, and physical-device acceptance

The macOS release workflow automates notarized installer builds when triggered by a
version tag or manual dispatch. It requires Developer ID Application and Installer
credentials in the CI environment and publishes a GitHub release only after successful
notarization and Gatekeeper acceptance.

Both public OAuth clients, idempotent authored-asset publication, and
authenticated synthetic production-Atrium acceptance are live verified.
`pnpm verify:pilot` remains intentionally red until a receipt matches the exact
signed, published, PSD-only store item. `pnpm verify:distribution` also requires
a Developer ID Application signature accepted by Gatekeeper.

Unavailable live capabilities fail closed and do not disable local recording or
review. They must not be replaced with private image hosting or undocumented
production routes.

See [`docs/milestones.md`](../../docs/milestones.md),
[`docs/browser-v1-release.md`](../../docs/browser-v1-release.md), and
[`docs/browser-store-submission.md`](../../docs/browser-store-submission.md),
and
[`docs/macos-runbook.md`](../../docs/macos-runbook.md).
