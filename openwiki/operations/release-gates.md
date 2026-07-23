---
type: Guide
title: Release Gates and External Dependencies
description: Locally complete milestones, build artifacts, operational approvals, and unavailable live Atrium capabilities.
tags: [release, milestones, browser, macos, blockers]
---

# Release Gates and External Dependencies

M0 through M7 are locally complete. The repository builds an unsigned Chrome
extension ZIP and an ad-hoc-signed macOS application for synthetic evaluation.

## Locally verified

- Shared TypeScript/Swift contracts and fixtures
- Browser recording, worker restart recovery, editing, and irreversible redaction
- Durable private-default publication against the local Atrium mock
- Managed browser policy, safe diagnostics, data deletion, and rollback
- Native recording, permission degradation, region capture, pins, and mixed-display geometry
- Dependency license allowlist and high-severity audit

## External or operator gates

- Atrium production OAuth/token validation
- Immutable authored-asset upload and collection discovery/default
- Atrium idempotency and optimistic concurrency
- RFC 8252 native redirect registration
- District Chrome signing/store or managed distribution
- Apple distribution signing, notarization, MDM packaging, and physical-device acceptance
- Authenticated development-Atrium acceptance

Unavailable live capabilities fail closed and do not disable local recording or
review. They must not be replaced with private image hosting or undocumented
production routes.

See [`docs/milestones.md`](../../docs/milestones.md),
[`docs/browser-v1-release.md`](../../docs/browser-v1-release.md), and
[`docs/macos-runbook.md`](../../docs/macos-runbook.md).
