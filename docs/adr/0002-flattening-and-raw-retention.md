# ADR 0002: Flattened image boundary and raw retention

- Status: accepted
- Date: 2026-07-22

## Context

Screenshot annotations must remain editable during review, while anything entering a publication outbox must make opaque redactions irreversible. Keeping raw pixels after a derivative is approved increases local privacy risk and makes it easier for a future publishing path to select the wrong asset.

## Decision

- Platform-neutral editor commands own step order, crop geometry, annotations, and privacy status. Browser Canvas and Mac Core Graphics are rendering adapters for the same commands.
- Export decodes the raw image, applies crop and visual annotations, renders opaque redactions last, and re-encodes a new PNG. Text, EXIF, time, and compressed-text metadata chunks are prohibited in the derivative.
- Blur and mosaic are visual annotations only. A flagged sensitive region is approvable only when an opaque `redaction` geometry covers it.
- M2 defaults to `delete_after_flatten`: the derivative bytes, session mutation, raw-asset tombstone, raw-byte deletion, and durable command receipt commit in one IndexedDB transaction.
- `delete_after_submit` remains a policy option for a later managed deployment, but raw assets never become publishable and never enter an outbox.
- Finalization is terminal for editing when the default deletion policy is used. Further pixel edits require a new capture rather than silently relying on deleted source data.

## Consequences

The safest local default sacrifices post-finalization undo. The UI therefore completes all mandatory review before enabling finalization and clearly identifies the deletion boundary. Browser goldens decode exported bytes and inspect PNG chunks; the Mac renderer must pass the same pixel and metadata expectations before its editor is considered equivalent.
