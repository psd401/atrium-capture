# Capture Guide Writer assistant

Atrium Capture's AI guide writer runs one approved AI Studio assistant named
"Capture Guide Writer". The assistant receives step metadata only: action,
element role and accessible name, page or window title, and the current draft
instruction. It never receives screenshots, typed values, selectors, bounds,
file paths, or asset ids.

## Prompt

The assistant has one prompt, "Write guide", pinned to model
`us.anthropic.claude-sonnet-5-5`. Its content is committed verbatim in
`docs/atrium/capture-guide-writer.assistant.json` and reproduced here:

```
You receive JSON describing steps a staff member recorded while doing a task in a browser or a Mac app. For each step you get the action type, the UI element role and accessible name, the page or window title, and the current draft instruction. You never receive pixel captures, typed values, or URLs beyond an origin.

Write a guide for a colleague who has never done this task:
- A title of at most 12 words that names the task outcome.
- A summary of one to three sentences.
- For every step, in the given order: a title of at most 8 words and one or two sentences of instruction in the imperative mood. Use the accessible name in quotation marks when it names a control. Do not invent controls, values, or outcomes that are not in the metadata. Keep the step's draft instruction's meaning when it is specific.

Return only JSON matching this shape, with no prose and no code fence:
{
  "schemaVersion": 1,
  "sessionId": "<copy from input>",
  "title": "<string, 1-200 chars>",
  "summary": "<string, 1-600 chars>",
  "steps": [
    { "stepId": "<copy from input>", "title": "<string, 1-120 chars>", "instruction": "<string, 1-2000 chars>" }
  ]
}
Include every input stepId exactly once and no other ids.

Input:
${steps}
```

The single input field is named `steps`, type `long_text`, holding the JSON
string built by `buildGuideWriterRequest` and `serializeGuideWriterRequest` in
`packages/guide-writer`. The assistant's reply is parsed with
`parseGuideSuggestionText` and checked with `validateGuideSuggestion`, both in
`packages/guide-writer`, against `contracts/guide-suggestion.schema.json`.

## Import steps

1. In Atrium, go to **Admin → Assistants → Import**.
2. Upload `docs/atrium/capture-guide-writer.assistant.json`.
3. Before importing, confirm that `us.anthropic.claude-sonnet-5-5` matches an
   enabled model in the Atrium model catalog. The import maps `model_name` by
   exact catalog id and silently falls back to a different model when no
   catalog entry matches, so an unmatched id will not fail the import. It will
   just run the wrong model.
4. After import, open the new assistant and copy its numeric id from the
   assistant URL (for example `/assistants/42`).
5. Set that id as the Chrome managed policy `atriumGuideWriterAssistantId` and
   the Mac preference `AtriumGuideWriterAssistantId`.

## Sample reply

`validateGuideSuggestion` accepts the following reply shape. This is the
fixture used by the shared contract tests
(`packages/test-fixtures/fixtures/guide-suggestion-v1.json`):

```json
{
  "schemaVersion": 1,
  "sessionId": "10000000-0000-4000-8000-000000000001",
  "title": "Request a synthetic library card",
  "summary": "Open the synthetic request form, enter the requested details, and submit the request. The guide ends on the confirmation page.",
  "steps": [
    {
      "stepId": "20000000-0000-4000-8000-000000000001",
      "title": "Begin the request",
      "instruction": "Select Begin synthetic request to open the form."
    },
    {
      "stepId": "20000000-0000-4000-8000-000000000002",
      "title": "Enter the request label",
      "instruction": "Enter the requested value in the Synthetic request label field."
    },
    {
      "stepId": "20000000-0000-4000-8000-000000000003",
      "title": "Finish the request",
      "instruction": "Continue to the Synthetic request complete page to finish."
    }
  ]
}
```
