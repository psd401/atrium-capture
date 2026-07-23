---
type: Component
title: Browser Review and Irreversible Redaction
description: The side panel edits normalized steps and creates metadata-free publishable derivatives after mandatory privacy review.
tags: [editor, redaction, privacy-review, screenshots]
---

# Browser Review and Irreversible Redaction

The side panel supports instruction edits, reorder, delete, merge, insert,
crop, zoom, arrows, rectangles, text, highlights, blur, mosaic, and opaque
redaction. Automated sensitive-region suggestions require author review.

Blur and mosaic are annotations, not permanent secret removal. A flagged
sensitive region is satisfied only by an opaque redaction that covers it.

## Flattening boundary

Finalization:

1. Renders crop and annotations into a new raster.
2. Applies opaque redactions last.
3. Re-encodes the image without source metadata chunks.
4. Stores the derivative as `publishable_local`.
5. Tombstones and deletes or retains the raw local source according to policy.

Only the derivative can enter a publish plan. Golden tests decode exported
bytes, verify exact replacement pixels, and prove source metadata markers are
absent. Raw assets are rejected even under retry or retained-source policy.

See [`docs/security-and-privacy.md`](../../docs/security-and-privacy.md) and
[`docs/adr/0002-flattening-and-raw-retention.md`](../../docs/adr/0002-flattening-and-raw-retention.md).
