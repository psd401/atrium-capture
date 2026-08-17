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

The `RecordingScopePicker` presents a native `SCContentSharingPicker` to select
display or window scope before capture begins. The picker excludes the app's own
window and prevents mode switching during an active recording. This hardens the
workflow boundary and ensures explicit user intent before ScreenCaptureKit starts.

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

## Permission identity

macOS ties Screen Recording and Accessibility decisions to the app's code-signing
identity, not just its bundle ID. The default local build uses bundle
`org.psd401.AtriumCapture.Local` and display name "Atrium Capture Local" so
development artifacts cannot impersonate the production app in System Settings.
Legacy same-named local builds are rejected during assembly to prevent accidental
confusion with the signed production app.

`MacPermissionCenter.snapshot()` queries both permissions through
`CGPreflightScreenCaptureAccess()` and `AXIsProcessTrusted()`. The injectable
overload allows tests to verify probe behavior without TCC interaction.
Transition predicates `becameReady(from:to:)` and `lostReadiness(from:to:)`
detect the exact edge when both permissions become granted or when either is
revoked during an active session.

The workspace permission card shows the app path and a Finder-reveal action.
When System Settings shows Atrium Capture enabled but the app reports
**Not active for this copy**, the user must remove older entries from both
privacy lists after verifying the exact app location.

See [`docs/macos-runbook.md`](../../docs/macos-runbook.md).

## Source map

| Path | Responsibility |
| --- | --- |
| `Sources/AtriumCaptureMacPlatform/MacPermissionsAndAccessibility.swift` | Permission snapshot, transition predicates, request sequencing |
| `Sources/AtriumCaptureMacApp/AtriumCaptureMacApp.swift` | `CaptureAppModel` status handling, permission change observer |
| `Sources/AtriumCaptureMacApp/AtriumCaptureWorkspaceView.swift` | Permission card UI, identity guidance disclosure |
| `Tests/AtriumCaptureMacPlatformTests/MacPermissionCenterTests.swift` | Probe injection, transition, and sequencing tests |
