---
type: Security
title: Security and Privacy Model
description: Privacy is enforced by value-free semantics, trusted-context state ownership, irreversible image export, and an Atrium-only production boundary.
tags: [security, privacy, redaction, oauth, diagnostics]
---

# Security and Privacy Model

Atrium Capture is designed for district workflows where screenshots can contain
sensitive information. Privacy behavior is a release gate.

## Capture minimization

- Recording is explicit and visibly indicated.
- Password values are never read or retained.
- Ordinary input becomes generic intent, never literal text.
- Raw HTML, network traffic, cookies, page storage, and form state are out of scope.
- URL retention defaults to origin-only or none and excludes queries/fragments.
- Site policy is evaluated before browser listeners activate.

## Image lifecycle

Raw screenshots remain local and non-publishable. Review creates a new raster
with annotations and opaque redactions flattened into pixels, strips metadata,
and marks only that derivative publishable. The raw source never enters the
outbox and is deleted according to the applied retention policy.

## Credentials and diagnostics

Browser tokens remain in the extension service worker; native refresh
credentials remain in Keychain. Tokens are excluded from capture sessions,
content scripts, bridge messages, diagnostics, and logs. Support exports contain
operational counts, fixed capability/error codes, and no text, URL, identifier,
token, or pixel content.

## Network boundary

Atrium is the sole production destination. The clients contain no analytics,
crash reporter, third-party AI call, or screenshot host. The OpenWiki workflow
documents repository source and synthetic fixtures only; it does not run in
either capture client or receive captured data.

See [`docs/threat-model.md`](../../docs/threat-model.md) and
[`docs/security-and-privacy.md`](../../docs/security-and-privacy.md).
