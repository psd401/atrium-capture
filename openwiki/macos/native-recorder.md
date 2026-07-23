---
type: Component
title: Native macOS Recorder
description: SwiftUI and AppKit combine ScreenCaptureKit pixels with value-free Accessibility semantics in the shared CaptureSession contract.
tags: [macos, swiftui, appkit, screencapturekit, accessibility]
---

# Native macOS Recorder

The native app targets macOS 14 or newer and uses only Apple frameworks plus
repository code. Screen Recording supplies pixels; Accessibility supplies
bounded semantic roles, names, and actions. The adapter never reads
`kAXValueAttribute`, and secure-text roles are rejected before capture.

## Recovery and privacy

Event receipts and the normalized session are persisted before acknowledgement.
A serialized frame queue prevents overlapping ScreenCaptureKit calls.
Reprocessed receipts and merged events cannot leave duplicate or unreferenced
publishable assets.

Native review uses generated crop and annotation commands. Screenshot-bearing
input steps require an opaque redaction before flattening and approval. Core
Graphics creates metadata-stripped PNG derivatives, and the filesystem outbox
accepts only `publishable_local` assets.

## Authentication and bridge

`ASWebAuthenticationSession` performs public-client PKCE authentication and
Keychain holds validated bearer credentials. Live authentication remains gated
on documented Atrium native redirect support. The optional Chrome bridge allows
only small semantic/control JSON and rejects image/token fields recursively.

See [`docs/macos-runbook.md`](../../docs/macos-runbook.md).
