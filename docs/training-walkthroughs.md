# Atrium training walkthroughs

Two synthetic training documents were submitted to production Atrium as private
drafts on 2026-07-25:

| Title                                        | Steps | Reviewed images | Atrium state  |
| -------------------------------------------- | ----: | --------------: | ------------- |
| Atrium Capture browser extension walkthrough |     5 |               5 | Private draft |
| Atrium Capture Mac app walkthrough           |    10 |              10 | Private draft |

Both drafts used the normal native production gateway, bundled public OAuth
client, durable outbox, direct authored-asset upload, version creation, and
title synchronization. Every asset reached `ready`, each document reached
`ready_as_draft`, and neither requested internal publication.

The screenshots contain synthetic fixtures only. Before import, each source PNG
was matched against a fixed SHA-256 digest. The normal review pipeline then
flattened and re-encoded every image, stripped metadata, deleted the raw local
asset from publication eligibility, and uploaded only the publishable
derivative. The rendered documents were inspected in Atrium at their first,
middle, and final steps for image loading, instruction order, clipping, and
word wrapping.

The one-time bounded importer used to assemble these guides was removed after
the drafts passed. It is not present in the shipped Mac app or repository
history. Private authoring URLs are intentionally not committed because this
MIT repository may be public; authorized staff can find the drafts by their
exact titles in Atrium.

An authorized district editor may publish either draft internally after a final
content review. Do not make the training documents public or replace their
synthetic screenshots with production/student content.
