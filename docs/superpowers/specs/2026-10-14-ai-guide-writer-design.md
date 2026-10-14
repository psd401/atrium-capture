# AI guide writer

Date: 2026-10-14. Status: approved for planning.

## Outcome

After a user finishes redaction review, Atrium Capture can fill in the guide
title, a short summary, and every step's title and instruction by running a
district-approved Atrium assistant over the reviewed capture. The user edits
the suggested text and publishes as today. Nothing publishes without the user
looking, and the model sees only non-sensitive step metadata: action type,
element role and accessible name, page title and policy-filtered origin, Mac
app and window title, and the current rules text. No screenshot leaves the
device for this feature in this iteration.

This fills the existing `instruction.source: "district_ai"` slot in
`contracts/capture-session.schema.json`, which no code populates today, and
satisfies the AGENTS.md rule that AI-assisted rewriting must go through the
Atrium/AI Studio boundary under explicit policy.

## Decisions

- The model runs in Atrium. The clients call the documented Assistant
  Execution API (`POST /api/v1/assistants/{id}/execute`) on one approved
  assistant, "Capture Guide Writer". No model key, provider SDK, or prompt
  lives in a client.
- The AI step sits after redaction review and before publish. The button is
  enabled only when `canFinalizeReview(session)` is true.
- Suggested text never overwrites user text. A step whose
  `instruction.userEdited` is true keeps its `editedText`; the suggestion
  replaces only `generatedText` and sets `source` to `district_ai`.
- A district policy switch can turn the feature off. The clients then hide the
  button and never call the assistant.
- Metadata only. Atrium's temporary-attachment staging route
  (`/api/repositories/temporary-attachments`) authenticates with the NextAuth
  session cookie, not a bearer token, and routes files into repository
  ingestion rather than model vision input. A bearer client cannot use it.
  Vision input is a backlog item that needs an aistudio change first.
- The AI step stays out of the durable publish job, which is the most
  carefully tested code in the repository.

## Atrium side (psd401/aistudio)

1. An administrator creates the approved assistant "Capture Guide Writer" with
   one input, `steps` (long_text, JSON). The prompt instructs the model to
   return only JSON matching the `guide-suggestion` contract below. The
   assistant's JSON export is committed to this repository under
   `docs/atrium/capture-guide-writer.assistant.json` so it can be re-imported.
2. A migration adds `assistants:execute` to the registered scope allowlist of
   the two first-party Atrium Capture OAuth clients, following the migration
   134 pattern that marked them first-party. The assistant id is
   configuration, not a secret. Clients read it from managed policy
   (`atriumGuideWriterAssistantId`) or the Mac preference
   (`AtriumGuideWriterAssistantId`), with a bundled default that is set once
   the production assistant exists.

## Contract: `contracts/guide-suggestion.schema.json`

```json
{
  "schemaVersion": 1,
  "sessionId": "<uuid>",
  "title": "<1..200 chars>",
  "summary": "<1..600 chars>",
  "steps": [{ "stepId": "<uuid>", "title": "<1..120 chars>", "instruction": "<1..2000 chars>" }]
}
```

`additionalProperties: false` everywhere. Every `stepId` must exist in the
session; unknown ids fail validation and the whole suggestion is rejected.
Generated TypeScript and Swift models follow the existing generator.

## Shared package `packages/guide-writer`

Platform neutral, no DOM, no Chrome, no AppKit. Exports:

- `buildGuideWriterRequest(session)`: returns the `steps` JSON the assistant
  reads: sessionId, current title, and per step the stepId, sequence, action,
  target role and accessible name, browser page title and policy-filtered
  origin or Mac app name and window title, and the current instruction text.
  It never includes typed values, selectors, bounds, paths, asset ids, or
  image bytes. Browser origins obey the session's `sourceUrlRetention` policy
  through `normalizeCaptureSourceOriginForPublication`. The serialized
  request must stay under the 128 KiB execute transport limit; a session that
  cannot fit is rejected with `guide_request_too_large` before any network
  call.
- `validateGuideSuggestion(json, session)`: schema plus stepId membership.
- `applyGuideSuggestion(session, suggestion)`: returns the editor commands
  `update_title` and one `suggest_instruction` per step.

`packages/editor-model` gains one command:
`{ kind: 'suggest_instruction'; stepId; text; title? }`. It sets
`generatedText` and `source: 'district_ai'`, leaves `editedText` and
`userEdited` untouched, and stores the step title in a new optional
`instruction.title` string (1 to 120 chars) added to
`contracts/capture-session.schema.json`. The addition is backward compatible:
existing sessions without `title` still validate, and both fixture suites
gain a session with the field set. Markdown generation in `atrium-client`
emits the title as the step heading when present and otherwise keeps its
current numbering. It prefers `editedText` and falls back to
`generatedText`, unchanged.

## Gateway

`AtriumGateway` gains:

- `executeGuideWriter({ assistantId, steps })` posts to
  `/api/v1/assistants/{assistantId}/execute` with `Accept: application/json`,
  receives a 202 job, polls `/api/v1/jobs/{jobId}` until a terminal status,
  and returns the completed job's text. Polling honors the server's
  `pollingInterval` (clamped to 1 to 10 seconds), the existing 30 second
  per-request deadline, and a 120 second overall budget.

`ProductionAtriumGateway`, `MockAtriumGateway`, `UnavailableAtriumGateway`,
and the Swift `ProductionNativeAtriumGateway` all implement it.
`capabilities()` reports `guideWriter: true` when the gateway is live.

The OAuth scope lists in both clients add `assistants:execute`.

## Client flow

Browser side panel and Mac workspace both show one button, "Write with AI",
in the review toolbar. Rules:

1. Hidden when policy is `off` or the gateway reports no guide writer.
2. Disabled until `canFinalizeReview(session)` is true.
3. On press: build the request, execute, apply commands, persist the session.
   The step list updates as a whole when the job completes; a progress row
   shows "Writing step titles and instructions".
4. On any failure the rules text stays, one inline retry appears, and the
   diagnostics log records the bounded error. No partial suggestion is
   applied.
5. A second press re-runs and replaces earlier `district_ai` text but still
   never touches user-edited steps.

Policy keys: Chrome managed `aiGuideWriting` and Mac preference
`AtriumAIGuideWriting`, values `on` or `off`, default `on`. Documented in
`docs/browser-managed-policy.md` and `docs/macos-runbook.md`.

## Error handling

- Request over the transport limit: fail before any network call, show the
  step count limit.
- Job failed, cancelled, or over budget: fail the whole run, show retry.
- Suggestion fails validation: same, with a diagnostics entry naming the
  first violation. The raw model text is not persisted.
- Token lacks the execute scope: capabilities already hid the button; a late
  403 is treated as policy off for the session.

## Testing

- Contract fixture `packages/test-fixtures/guide-suggestion.v1.json` decodes in
  TypeScript and Swift.
- `guide-writer` unit tests: request contains no asset id, image bytes,
  typed value, selector, bounds, or path; origins follow policy; oversize
  sessions reject before network; unknown stepId rejects; user-edited steps
  survive `applyGuideSuggestion`.
- `editor-model` test for `suggest_instruction`.
- Gateway tests with injected production-shaped responses: execute request
  shape and headers, 202 then polling until `completed`, `failed` and
  `cancelled` mapping, 403 handling, deadline abort.
- Browser: one extension-loaded Playwright run over the synthetic fixture site
  using the mock gateway, asserting the button gating and applied text.
- Mac: XCTest for the native gateway methods and the workspace gating state.
- Live acceptance with a district test account is a separate, documented step
  and is not part of CI.

## Out of scope

Vision input (screenshots to the model) until aistudio exposes a
bearer-capable image input for assistant execution. Automatic redaction
suggestions, voice narration, exports, and ambient capture. See
`docs/superpowers/backlog.md`.
