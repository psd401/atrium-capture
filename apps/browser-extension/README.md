# Browser extension

Planned stack: WXT, React, TypeScript, Manifest V3, IndexedDB, and the Chrome Side Panel API.

Responsibilities:

- Content script: observe permitted page events and extract bounded semantic context.
- Service worker: own the capture state machine, screenshots, local outbox, OAuth, and Atrium gateway.
- Side panel/full review: show recording state, edit/reorder steps, flatten redactions, and submit reviewed content.

The first implementation should use synthetic fixture pages and a local fake Atrium gateway. Do not begin remote publishing until the asset and production OAuth contracts are available.

