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

Region and focused-element quick captures append to the current unpublished
guide. The title and manual steps remain editable through preparation; adding
content reopens privacy review. Once a durable Atrium job exists, step/image
content stays frozen for that version while titles remain editable and
reconcile through Atrium metadata updates. New and saved-guide controls keep the
active editor independent from older background outbox recovery. Storage rejects
guide switching during recording and serializes title saves with the Submitted
transition, so a stale recorder snapshot cannot regress the durable session.

Native review uses generated crop and annotation commands. Screenshot-bearing
input steps require an opaque redaction before flattening and approval. Core
Graphics creates metadata-stripped PNG derivatives, and the filesystem outbox
accepts only `publishable_local` assets.

## Authentication and bridge

`ASWebAuthenticationSession` performs public-client PKCE authentication and
Keychain holds validated bearer credentials. Live authentication remains gated
on documented Atrium native redirect support. The optional Chrome bridge allows
only small semantic/control JSON and rejects image/token fields recursively.

The SwiftUI workspace and menu-bar extra share one `CaptureAppModel`. The menu
can show the workspace, initiate capture, and control recording. Start at login
uses the user-controlled `SMAppService.mainApp` login item and introduces no
background daemon or privileged helper.

See [`docs/macos-runbook.md`](../../docs/macos-runbook.md).
