# Threat model

## Scope and assets

Atrium Capture handles local workflow semantics, raw screenshots, author edits, flattened publishable images, OAuth credentials in trusted contexts, and durable Atrium publication state. Atrium is the only production network destination. Browser page content, content scripts, native-message senders, imported session files, and remote responses are untrusted inputs.

## Trust boundaries

1. A web page emits DOM events to a content script. The script extracts bounded semantics but no field value.
2. The service worker validates every content-script envelope before persisting or acknowledging it.
3. Raw images remain in local asset storage. Only a newly rendered, metadata-free derivative that passes privacy review can enter the outbox.
4. OAuth and Atrium requests run in the service worker or native app. Tokens never cross into content scripts, native messages, capture documents, diagnostics, or logs.
5. Optional native messaging carries validated semantic/control JSON only. Each client uploads its own images directly to Atrium.

## Principal threats and controls

| Threat                                                            | Security or privacy impact                              | Required control                                                                                                          | Verification                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Malicious page forges privileged messages                         | Unauthorized recording, state mutation, or token access | Narrow message schema, sender/tab checks, service-worker-owned state machine, no privileged generic RPC                   | Schema and negative integration tests         |
| Password or ordinary input value is captured                      | Credential or personal-data disclosure                  | Never read password values; convert ordinary input to generic intent; omit value fields from contracts                    | Sensitive-field unit and extension tests      |
| Service worker stops after acknowledgement but before persistence | Lost or duplicated steps                                | Serialize events and commit session revision/event receipt in IndexedDB before acknowledgement                            | Forced-restart integration test               |
| Concurrent screenshot calls are mismatched                        | Wrong pixels attached to a step                         | One service-worker capture queue with persisted association                                                               | Ordering and restart tests                    |
| Visual redaction is reversible                                    | Disclosure in uploaded bytes                            | Opaque pixel replacement in a new raster; metadata stripping; source excluded from outbox; delete per policy              | Byte-level image goldens and outbox tests     |
| Retry creates duplicate Atrium objects, versions, or assets       | Data duplication and inconsistent drafts                | Stable write keys; persisted IDs; deterministic asset lookup/completion; fail-safe wait after ambiguous reservation       | Failure injection and gateway contract tests  |
| Token leaks into page, native message, or diagnostics             | Account compromise                                      | Trusted-context token store, field allowlists, log redaction, payload size/type limits                                    | Boundary and diagnostics tests                |
| Broad host permission records unintended sites                    | Excessive collection                                    | User-started visible recording, managed allow/deny policy before listeners, optional host access, visible indicator       | Policy and extension-loaded tests             |
| Malformed or stale administrator policy weakens privacy           | Capture on a denied site or excess retention            | Chrome managed schema, strict worker validation, fail-closed empty allow list, immediate refresh, stricter-wins retention | Managed-policy and recorder-service tests     |
| Support export leaks guide content or credentials                 | Secondary disclosure through support workflow           | Fixed content-free diagnostic shape; counts/codes only; no automatic transmission                                         | Unit and downloaded-export assertions         |
| Storage exhaustion truncates an acknowledged workflow             | Lost state or privacy-unsafe partial data               | Managed byte/step budgets; pause before oversized image commit; transactional IndexedDB                                   | Quota boundary and restart tests              |
| Tampered persisted/imported state bypasses privacy review         | Unreviewed publication                                  | Validate and migrate on every read; recompute publishability; gateway accepts only publishable assets                     | Migration and corrupted-state tests           |
| Compromised dependency or build                                   | Code execution or data exfiltration                     | Exact lockfile, reviewed permissive licenses, high-severity audit gate, minimal dependencies, no telemetry                | CI license/audit checks and dependency review |
| Permission revocation on macOS                                    | Silent loss or accidental broad capture                 | Point-of-use checks, degraded editor-only mode, stop active capture on permission change                                  | Unit tests and manual permission matrix       |
| Native host sends an oversized or privileged response             | Token/pixel disclosure or worker compromise             | Optional permission, fixed host allow-origin, 64 KiB client bound, exact envelope validation, recursive image/token deny  | Browser and host negative tests               |
| Pin/clipboard history outlives district need                      | Local screenshot disclosure                             | Bounded local history, explicit deletion, do-not-copy option, owner-aware timed clipboard clearing                        | Pin/clipboard persistence tests and runbook   |

## Privacy abuse cases

- A recorder must not infer that a visible password is safe because the field changes type dynamically; password classification is repeated at event time.
- A user cannot publish while any step or asset requires privacy review.
- Page content cannot read managed policy, diagnostics, outbox state, OAuth tokens, or local images.
- Blur and mosaic are annotations, not sufficient permanent redaction for secrets. A redaction command always emits opaque replacement pixels.
- Diagnostics identify versions, policy decisions, storage pressure, and sanitized error codes only; they never include URLs beyond configured retention, accessible text, instructions, screenshots, tokens, or form data.

## Residual and external risk

Production publication uses Atrium's documented OAuth, immutable content-asset, idempotent content/version/publication, and concurrency contracts. Live sign-in is disabled until the appropriate public client UUID is configured. Asset initiation itself is not idempotent; after an ambiguous reservation response, the client recovers matching rows or waits for expiry rather than racing another reservation. ADR 0006 records the residual expired-row risk. No substitute screenshot host is permitted.
