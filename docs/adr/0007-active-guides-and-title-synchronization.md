# ADR 0007: Active guides and durable Atrium title synchronization

- Status: accepted
- Date: 2026-07-24

## Context

An Atrium draft is not the end of a guide's useful lifecycle. A user may need to
correct its title after the bodyless object, private draft, or internal
publication already exists. Users also need to begin another guide while an
older outbox job is retrying. Treating the latest outbox job as the active guide
made both workflows impossible and allowed background recovery to replace the
guide visible in the editor.

Object creation is idempotent. Changing the create body after Atrium may have
committed the first request would make a retry conflict with that request.
Atrium separately documents metadata updates through
`PATCH /api/v1/content/{id}` with the `content:update` scope.

## Decision

- The active guide and the durable publication outbox are independent. Recovery
  may advance every pending job, but it updates the visible editor only when the
  recovered job belongs to the active guide.
- **New guide** and **Start new recording** preserve the current normalized
  session before activating a new one. Saved guides remain selectable; beginning
  another guide never deletes or cancels an older outbox job. The persistence
  boundary rejects guide switching while recording or paused; disabled controls
  are not the safety boundary.
- New publish jobs persist an optional `createTitle` snapshot before the first
  object-create request. A legacy job snapshots the current pre-edit title before
  accepting its first post-upgrade rename, or atomically snapshots its current
  title before its first post-upgrade create request.
- The session title is desired local state. Once an object ID is known, clients
  reconcile it through the documented metadata `PATCH`. `remoteTitle` records
  the last title Atrium confirmed, so interrupted updates are naturally safe to
  repeat.
- Generated Markdown does not duplicate the mutable object title. The Atrium
  content object is the single title authority, so a metadata rename cannot
  leave a stale heading embedded in an otherwise immutable version.
- Title edits remain available in every session state. Step/image edits remain
  frozen after a publication job begins because changing an already-snapshotted
  body requires an explicit new-version workflow; the UI directs users to start
  a new guide for different content.
- The native repository serializes title updates and the Submitted transition.
  Reconciliation never lets a stale recorder snapshot regress a submitted or
  archived session, resurrect deleted-raw metadata, or replace a newer stored
  revision. This is enforced below the SwiftUI layer and covered in restart/race
  tests.

## Consequences

An ambiguous create retry always reuses the original title and idempotency key,
then applies the latest title after the original object is recovered. Browser
and native tests inject a lost create response, rename locally, recover one
object, and confirm the final remote title. The additive optional contract fields
continue to decode older outbox records in both languages.
