# AI guide writer

Date: 2026-10-14. Status: approved for planning.

## Outcome

After a user finishes redaction review, Atrium Capture can fill in the guide
title, a short summary, and every step's title and instruction by running a
district-approved Atrium assistant over the reviewed capture. The user edits
the suggested text and publishes as today. Nothing publishes without the user
looking, and the model only ever sees what Atrium would receive anyway:
flattened, redacted, publishable images plus the non-sensitive step metadata.

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
- Images cross the wire twice (assistant staging, then content assets). This is
  accepted to keep the AI step out of the durable publish job, which is the
  most carefully tested code in the repository.

## Atrium side (psd401/aistudio)

1. An administrator creates the approved assistant "Capture Guide Writer" with
   inputs `steps` (long_text, JSON) and `screenshots` (file_upload). The
   prompt instructs the model to return only JSON matching the
   `guide-suggestion` contract below. The assistant's JSON export is committed
   to this repository under `docs/atrium/capture-guide-writer.assistant.json`
   so it can be re-imported.
2. A migration adds `assistant:{id}:execute` to the registered scope allowlist
   of the two first-party Atrium Capture OAuth clients. The assistant id is
   configuration, not a secret, and is bundled like the client UUIDs.
3. Spike before implementation: confirm that a PNG staged through the
   authenticated temporary-attachment API reaches the selected model as vision
   input. If it does not, the assistant runs on step metadata only and the gap
   is filed against aistudio. The client design does not change either way.

## Contract: `contracts/guide-suggestion.schema.json`

```json
{
  "schemaVersion": 1,
  "sessionId": "<uuid>",
  "title": "<1..200 chars>",
  "summary": "<1..600 chars>",
  "steps": [
    { "stepId": "<uuid>", "title": "<1..120 chars>", "instruction": "<1..2000 chars>" }
  ]
}
```

`additionalProperties: false` everywhere. Every `stepId` must exist in the
session; unknown ids fail validation and the whole suggestion is rejected.
Generated TypeScript and Swift models follow the existing generator.

## Shared package `packages/guide-writer`

Platform neutral, no DOM, no Chrome, no AppKit. Exports:

- `buildGuideWriterRequest(session, policy)`: returns `{ steps, assets }`.
  `steps` is the JSON the assistant reads: sequence, action, target role and
  accessible name, browser origin and page title or Mac app and window title,
  and the current rules text. It never includes typed values, selectors,
  password hints, raw assets, or any asset whose state is not
  `publishable_local`. Browser origins obey the same retention policy as
  publication (`normalizeCaptureSourceOriginForPublication`).
- `batchGuideWriterRequest(request, maxImages = 10)`: splits a session with
  more than ten publishable images into ordered batches that share the title
  and summary from the first batch.
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

- `stageAttachment({ bytes, mimeType, filename })` returns an opaque marker
  string from the authenticated staging API. Bytes are a `publishable_local`
  derivative only; the gateway refuses any other state.
- `executeGuideWriter({ assistantId, steps, markers, deadlineMs })` posts to
  the execute route with `Accept: application/json`, polls `/api/v1/jobs/{id}`
  until terminal, and returns the raw JSON text. Polling respects the existing
  30 second API deadline per request and a 120 second overall budget.

`ProductionAtriumGateway`, `MockAtriumGateway`, `UnavailableAtriumGateway`,
and the Swift `ProductionNativeAtriumGateway` all implement both. `capabilities()`
reports `guideWriter: true` only when the token carries the execute scope and
policy allows it.

The OAuth scope lists in both clients add `assistant:{id}:execute`.

## Client flow

Browser side panel and Mac workspace both show one button, "Write with AI",
in the review toolbar. Rules:

1. Hidden when policy is `off` or the gateway reports no guide writer.
2. Disabled until `canFinalizeReview(session)` is true.
3. On press: stage images, execute, apply commands, persist the session. The
   step list updates as a whole when the job completes; a progress row shows
   "Writing step titles and instructions".
4. On any failure the rules text stays, one inline retry appears, and the
   diagnostics log records the bounded error. No partial suggestion is
   applied.
5. A second press re-runs and replaces earlier `district_ai` text but still
   never touches user-edited steps.

Policy keys: Chrome managed `aiGuideWriting` and Mac preference
`AtriumAIGuideWriting`, values `on` or `off`, default `on`. Documented in
`docs/browser-managed-policy.md` and `docs/macos-runbook.md`.

## Error handling

- Staging rejected or expired marker: fail the whole run, show retry.
- Job failed, cancelled, or over budget: same.
- Suggestion fails validation: same, with a diagnostics entry naming the
  first violation. The raw model text is not persisted.
- Token lacks the execute scope: capabilities already hid the button; a late
  403 is treated as policy off for the session.

## Testing

- Contract fixture `packages/test-fixtures/guide-suggestion.v1.json` decodes in
  TypeScript and Swift.
- `guide-writer` unit tests: request contains no `raw_local` or
  `redacted_local` asset, no typed value, no selector, no password hint;
  origins follow policy; batching preserves order; unknown stepId rejects;
  user-edited steps survive `applyGuideSuggestion`.
- `editor-model` test for `suggest_instruction`.
- Gateway tests with injected production-shaped responses: staging request
  shape, execute body under 128 KiB, polling until `completed`, 403 handling,
  deadline abort.
- Browser: one extension-loaded Playwright run over the synthetic fixture site
  using the mock gateway, asserting the button gating and applied text.
- Mac: XCTest for the native gateway methods and the workspace gating state.
- Live acceptance with a district test account is a separate, documented step
  and is not part of CI.

## Out of scope

Automatic redaction suggestions, voice narration, exports, and ambient capture.
See `docs/superpowers/backlog.md`.
