# AI Guide Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After redaction review, a "Write with AI" button fills the guide title, summary, and every step's title and instruction from a district-approved Atrium assistant, as editable text the user reviews before publishing.

**Architecture:** A new platform-neutral package `packages/guide-writer` builds a metadata-only request from the reviewed session, validates the assistant's JSON reply against a new shared contract, and turns it into editor commands. `AtriumGateway` (TypeScript) and `NativeAtriumGateway` (Swift) gain one method that runs the assistant through Atrium's documented async execute-and-poll API. Both clients add one button, one policy switch, and one service that wires those together. No screenshot bytes are sent.

**Tech Stack:** TypeScript (Bun workspaces, Vitest, WXT/React MV3 extension), Swift 6 (SwiftPM, XCTest, SwiftUI), JSON Schema 2020-12 with quicktype generation, Ajv for message validation.

**Spec:** `docs/superpowers/specs/2026-10-14-ai-guide-writer-design.md`

## Global Constraints

- Run `bun`, never `npm` or `pnpm`. Run Swift tests with `bun run swift:test` (requires Xcode on macOS).
- Contracts in `contracts/*.schema.json` are the source of truth. After any schema change run `bun run contracts:generate` and commit the generated `packages/contracts/src/generated/contracts.ts` and `apps/macos/Sources/AtriumCaptureContracts/Generated/Contracts.swift`. `bun run contracts:check` must pass.
- After any change to `apps/browser-extension/src/message.schema.json` run `bun run messages:generate` and commit the generated validator.
- Every new code file starts with a two-line `ABOUTME:` comment.
- Never send typed values, selectors, bounds, paths, asset ids, image bytes, or tokens to the assistant. The request contains only: sessionId, title, and per step `stepId`, `sequence`, `action`, `role`, `accessibleName`, `pageTitle`, `origin` (policy filtered), `appName`, `windowTitle`, `instruction`.
- Suggested text never overwrites user text: a step with `instruction.userEdited === true` keeps `editedText`.
- The feature is reachable only when `canFinalizeReview(session)` (TypeScript) or the equivalent Swift check is true.
- Policy keys: Chrome managed `aiGuideWriting` (`"on" | "off"`, default `on`) and `atriumGuideWriterAssistantId` (positive integer); Mac preferences `AtriumAIGuideWriting` and `AtriumGuideWriterAssistantId`.
- OAuth scope added to both clients: `assistants:execute`.
- Execute request body must be under 128 KiB (`131072` bytes of UTF-8 JSON). Reject larger sessions before any network call with error code `guide_request_too_large`.
- Per-request deadline 30 s, overall guide-writer budget 120 s, polling interval from the server clamped to 1000 to 10000 ms.
- Synthetic data only in fixtures and tests. No real names, URLs, or screenshots.
- Prettier formats everything: run `bun run format` before each commit. `bun run lint` must report zero warnings.

## Review Focus

1. A step whose `instruction.userEdited` is true and whose stepId appears in the suggestion must keep its `editedText` after apply. Pinned in Task 3 (`applyGuideSuggestion` test) and Task 2 (`suggest_instruction` command test).
2. A suggestion that lists a stepId not in the session, or omits a session step, must be rejected whole, with no partial apply. Pinned in Task 3.
3. A session whose serialized request exceeds 131072 bytes must fail with `guide_request_too_large` before `fetch` is called. Pinned in Task 3 (size test) and Task 4 (gateway never called).
4. A poll response with `status: "failed"` or `"cancelled"`, or a poll loop that exceeds 120 s, must surface a retryable `GatewayError` and leave the session unchanged. Pinned in Task 4 and Task 5.
5. With managed policy `aiGuideWriting: "off"` or no assistant id, the button must be hidden and the service must refuse to call the gateway even if a message arrives. Pinned in Task 5 (service test) and Task 6 (Mac model test).

---

### Task 1: Shared contract for guide suggestions and the optional step title

**Files:**

- Create: `contracts/guide-suggestion.schema.json`
- Modify: `contracts/capture-session.schema.json` (`$defs.instruction.properties`)
- Modify: `contracts/README.md` (file list and additive history)
- Modify: `scripts/generate-contracts.mjs:11-15` (`sources` array)
- Modify: `scripts/validate-contracts.mjs:9-24` (`schemaFixtures` array)
- Create: `packages/test-fixtures/fixtures/guide-suggestion-v1.json`
- Modify: `packages/test-fixtures/fixtures/capture-session-v1.json` (first step gains `instruction.title`)
- Modify: `packages/contracts/test/contracts.test.ts`
- Modify: `apps/macos/Tests/AtriumCaptureContractsTests/ContractFixtureTests.swift`
- Generated (commit after `bun run contracts:generate`): `packages/contracts/src/generated/contracts.ts`, `apps/macos/Sources/AtriumCaptureContracts/Generated/Contracts.swift`

**Interfaces:**

- Produces TypeScript types from `@atrium-capture/contracts`: `AtriumCaptureGuideSuggestion { schemaVersion: number; sessionId: string; title: string; summary: string; steps: GuideSuggestionStep[] }`, `GuideSuggestionStep { stepId: string; title: string; instruction: string }`, and `Instruction.title?: string`.
- Produces Swift types in `AtriumCaptureContracts`: `AtriumCaptureGuideSuggestion`, `GuideSuggestionStep`, and `Instruction.title: String?`.

- [ ] **Step 1: Write the failing TypeScript fixture test**

Append to `packages/contracts/test/contracts.test.ts` inside the existing `describe('generated contract fixtures', ...)` block:

```ts
it('loads a guide suggestion that names only session step ids', async () => {
  const suggestion = await readFixture<AtriumCaptureGuideSuggestion>('guide-suggestion-v1.json');
  const session = await readFixture<AtriumCaptureSession>('capture-session-v1.json');
  const sessionStepIds = new Set(session.steps.map((step) => step.stepId));

  expect(suggestion.schemaVersion).toBe(1);
  expect(suggestion.sessionId).toBe(session.sessionId);
  expect(suggestion.steps).toHaveLength(session.steps.length);
  for (const step of suggestion.steps) {
    expect(sessionStepIds.has(step.stepId)).toBe(true);
  }
  expect(JSON.stringify(suggestion)).not.toMatch(/data:image|selector|bearer/i);
});

it('decodes an optional step title on the shared capture session', async () => {
  const session = await readFixture<AtriumCaptureSession>('capture-session-v1.json');

  expect(session.steps[0]?.instruction.title).toBe('Begin the request');
  expect(session.steps[1]?.instruction.title).toBeUndefined();
});
```

Add `type AtriumCaptureGuideSuggestion,` to the import list from `'../src/index.js'`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run packages/contracts`
Expected: FAIL. `AtriumCaptureGuideSuggestion` is not exported and the fixture file is missing.

- [ ] **Step 3: Write the guide-suggestion schema**

Create `contracts/guide-suggestion.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://atrium-capture.psd401.net/contracts/guide-suggestion.schema.json",
  "title": "AtriumCaptureGuideSuggestion",
  "description": "Assistant-written title, summary, and per-step text for a reviewed capture session. Text only; never images, selectors, or typed values.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "sessionId", "title", "summary", "steps"],
  "properties": {
    "schemaVersion": { "type": "integer", "const": 1 },
    "sessionId": { "type": "string", "format": "uuid" },
    "title": { "type": "string", "minLength": 1, "maxLength": 200 },
    "summary": { "type": "string", "minLength": 1, "maxLength": 600 },
    "steps": {
      "type": "array",
      "minItems": 1,
      "maxItems": 1000,
      "items": { "$ref": "#/$defs/guideSuggestionStep" }
    }
  },
  "$defs": {
    "guideSuggestionStep": {
      "type": "object",
      "additionalProperties": false,
      "required": ["stepId", "title", "instruction"],
      "properties": {
        "stepId": { "type": "string", "format": "uuid" },
        "title": { "type": "string", "minLength": 1, "maxLength": 120 },
        "instruction": { "type": "string", "minLength": 1, "maxLength": 2000 }
      }
    }
  }
}
```

Check the exact `$id` prefix used by `contracts/capture-session.schema.json` and reuse it.

- [ ] **Step 4: Add the optional `title` to the instruction definition**

In `contracts/capture-session.schema.json`, inside `$defs.instruction.properties`, add after `editedText`:

```json
"title": {
  "type": "string",
  "minLength": 1,
  "maxLength": 120
}
```

Do not add it to `required`.

- [ ] **Step 5: Add the fixture and update the session fixture**

Create `packages/test-fixtures/fixtures/guide-suggestion-v1.json` using the three step ids from `capture-session-v1.json` (`20000000-0000-4000-8000-000000000001`, `...0002`, `...0003`; confirm by reading the fixture):

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
      "title": "Enter the account label",
      "instruction": "Enter the requested value in the Synthetic account label field."
    },
    {
      "stepId": "20000000-0000-4000-8000-000000000003",
      "title": "Submit the request",
      "instruction": "Select Submit synthetic request and wait for the confirmation page."
    }
  ]
}
```

Adjust instruction wording to match the fixture's actual accessible names. In `packages/test-fixtures/fixtures/capture-session-v1.json`, add `"title": "Begin the request"` to the first step's `instruction` object only.

- [ ] **Step 6: Register the schema in the generator and validator**

In `scripts/generate-contracts.mjs` add to `sources`:

```js
  ['GuideSuggestion', 'contracts/guide-suggestion.schema.json'],
```

In `scripts/validate-contracts.mjs` add to `schemaFixtures`:

```js
  [
    'contracts/guide-suggestion.schema.json',
    'packages/test-fixtures/fixtures/guide-suggestion-v1.json',
  ],
```

- [ ] **Step 7: Generate and check the contracts**

Run: `bun run contracts:generate && bun run contracts:validate && bun run contracts:check`
Expected: "Generated TypeScript and Swift contracts.", "Validated 6 shared contract fixtures.", "Generated contracts are current."

Open `packages/contracts/src/generated/contracts.ts` and confirm the exported names. quicktype names the top-level type from the schema `title`, as it does for `AtriumCaptureSession`, so expect `AtriumCaptureGuideSuggestion` with a nested `GuideSuggestionStep`. If quicktype picks a different name, rename in the schema `title` until the generated name is `AtriumCaptureGuideSuggestion`; do not hand-edit generated files. Confirm `Instruction` now has `title?: string`.

- [ ] **Step 8: Run the TypeScript test to verify it passes**

Run: `bun run vitest run packages/contracts`
Expected: PASS.

- [ ] **Step 9: Write the Swift fixture test and run it**

Append to `ContractFixtureTests` in `apps/macos/Tests/AtriumCaptureContractsTests/ContractFixtureTests.swift`:

```swift
    func testDecodesSharedGuideSuggestionFixture() throws {
        let suggestion = try AtriumContractCodec.makeDecoder().decode(
            AtriumCaptureGuideSuggestion.self,
            from: fixtureData(named: "guide-suggestion-v1.json")
        )
        let session = try AtriumContractCodec.makeDecoder().decode(
            AtriumCaptureSession.self,
            from: fixtureData(named: "capture-session-v1.json")
        )

        XCTAssertEqual(suggestion.schemaVersion, 1)
        XCTAssertEqual(suggestion.sessionID, session.sessionID)
        XCTAssertEqual(suggestion.steps.count, session.steps.count)
        XCTAssertEqual(session.steps[0].instruction.title, "Begin the request")
        XCTAssertNil(session.steps[1].instruction.title)
    }
```

quicktype renders `sessionId` as `sessionID` in Swift; check the generated file for the exact property names.

Run: `bun run swift:test`
Expected: PASS including the new test.

- [ ] **Step 10: Document the additive change**

In `contracts/README.md` add `guide-suggestion.schema.json` to the file list with one line: "assistant-written guide text keyed by session step id." Under "## 1.0 additive history" add at the top:

```
- 2026-10-14: added optional `Instruction.title`. Backward-compatible: legacy steps omit it and Markdown keeps numbered headings; the district AI guide writer and both editors may set it. Added `guide-suggestion.schema.json` (schema version 1) for assistant replies. The shared browser fixture exercises both in generated TypeScript and Swift models.
```

- [ ] **Step 11: Format, lint, and commit**

```bash
bun run format && bun run lint && bun run contracts:check
git add contracts packages/test-fixtures packages/contracts scripts/generate-contracts.mjs scripts/validate-contracts.mjs apps/macos/Sources/AtriumCaptureContracts/Generated/Contracts.swift apps/macos/Tests/AtriumCaptureContractsTests/ContractFixtureTests.swift
git commit -m "feat(contracts): guide suggestion schema and optional step title"
```

---

### Task 2: `suggest_instruction` editor command (TypeScript and Swift)

**Files:**

- Modify: `packages/editor-model/src/index.ts:14-27` (`EditorCommand` union) and the `switch` in `applyEditorCommand`
- Modify: `packages/editor-model/test/editor-model.test.ts`
- Modify: `apps/browser-extension/src/message.schema.json` (`$defs.editorCommand.oneOf`)
- Generated: `apps/browser-extension/src/generated/validate-extension-message.js` and `.d.ts` via `bun run messages:generate`
- Modify: `apps/browser-extension/test/messages.test.ts`
- Modify: `apps/macos/Sources/AtriumCaptureCore/NativeReviewEditor.swift`
- Modify: `apps/macos/Tests/AtriumCaptureCoreTests/NativePrivacyAndPublishingTests.swift` (or a new `NativeReviewEditorSuggestionTests.swift` in the same target)
- Modify: `packages/atrium-client/src/index.ts:552-580` (`generateMarkdown` step heading)
- Modify: `packages/atrium-client/test/atrium-client.test.ts`

**Interfaces:**

- Produces TypeScript: `EditorCommand` gains `{ kind: 'suggest_instruction'; stepId: string; text: string; title: string }`. Behavior: sets `instruction.generatedText = text`, `instruction.title = title`, `instruction.source = Source.DistrictAI`; keeps `editedText` and `userEdited`; does not change `privacyReview`; bumps `revision` and `updatedAt`.
- Produces Swift: `NativeReviewEditor.suggestInstruction(in:stepID:text:title:now:) throws -> AtriumCaptureSession` with the same behavior.
- Produces Markdown: `generateMarkdown` emits `## Step N: <title>` when `instruction.title` is set, else `## Step N`.

- [ ] **Step 1: Write the failing TypeScript tests**

Append to `packages/editor-model/test/editor-model.test.ts` inside `describe('editor commands', ...)`:

```ts
it('suggest_instruction fills generated text and title without touching user edits', () => {
  let session = fixtureSession();
  session = applyEditorCommand(session, {
    kind: 'update_instruction',
    stepId: firstStepId,
    text: 'My own words.',
  });
  session = applyEditorCommand(session, {
    kind: 'suggest_instruction',
    stepId: firstStepId,
    text: 'Select the synthetic button.',
    title: 'Open the form',
  });
  session = applyEditorCommand(session, {
    kind: 'suggest_instruction',
    stepId: secondStepId,
    text: 'Enter the requested value.',
    title: 'Fill the field',
  });

  const first = session.steps.find((step) => step.stepId === firstStepId);
  const second = session.steps.find((step) => step.stepId === secondStepId);
  expect(first?.instruction.editedText).toBe('My own words.');
  expect(first?.instruction.userEdited).toBe(true);
  expect(first?.instruction.generatedText).toBe('Select the synthetic button.');
  expect(first?.instruction.title).toBe('Open the form');
  expect(first?.instruction.source).toBe(Source.DistrictAI);
  expect(second?.instruction.editedText).toBeUndefined();
  expect(second?.instruction.userEdited).toBe(false);
  expect(second?.instruction.generatedText).toBe('Enter the requested value.');
  expect(second?.instruction.source).toBe(Source.DistrictAI);
});

it('suggest_instruction rejects empty or oversize text and unknown steps', () => {
  const session = fixtureSession();
  expect(() =>
    applyEditorCommand(session, {
      kind: 'suggest_instruction',
      stepId: firstStepId,
      text: '   ',
      title: 'Title',
    }),
  ).toThrow('invalid_instruction');
  expect(() =>
    applyEditorCommand(session, {
      kind: 'suggest_instruction',
      stepId: firstStepId,
      text: 'x'.repeat(2_001),
      title: 'Title',
    }),
  ).toThrow('invalid_instruction');
  expect(() =>
    applyEditorCommand(session, {
      kind: 'suggest_instruction',
      stepId: firstStepId,
      text: 'Fine.',
      title: 'x'.repeat(121),
    }),
  ).toThrow('invalid_title');
  expect(() =>
    applyEditorCommand(session, {
      kind: 'suggest_instruction',
      stepId: '10000000-0000-4000-8000-000000000099',
      text: 'Fine.',
      title: 'Title',
    }),
  ).toThrow('step_not_found');
});
```

Note: the fixture session in that file is in `review` state; `suggest_instruction` must be allowed in `review` like `update_instruction`. Check whether `fixtureSession()` steps are `approved`; the command must not change `privacyReview`, so add `expect(first?.privacyReview).toBe(before.privacyReview)` using a captured `before` value.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run packages/editor-model`
Expected: FAIL with a TypeScript error on the unknown command kind or a runtime switch fall-through.

- [ ] **Step 3: Implement the command**

In `packages/editor-model/src/index.ts` add to the `EditorCommand` union after `update_instruction`:

```ts
  | { kind: 'suggest_instruction'; stepId: string; text: string; title: string }
```

Add a `case` in the `switch` after `'update_instruction'`:

```ts
    case 'suggest_instruction': {
      const text = command.text.trim();
      if (!text || text.length > 2_000) {
        throw new Error('invalid_instruction');
      }
      const title = command.title.trim();
      if (!title || title.length > 120) {
        throw new Error('invalid_title');
      }
      return mapStep(session, command.stepId, now, (step) => ({
        ...step,
        instruction: {
          ...step.instruction,
          generatedText: text,
          source: Source.DistrictAI,
          title,
        },
      }));
    }
```

`mapStep` throws `step_not_found` for unknown ids (confirm by reading its definition near the bottom of the file). Confirm `mapStep` does not reset `privacyReview`; if it does, write the step mapping inline using `changed(session, steps, now)` instead.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run packages/editor-model`
Expected: PASS.

- [ ] **Step 5: Add the command to the extension message schema**

In `apps/browser-extension/src/message.schema.json`, inside `$defs.editorCommand.oneOf`, add after the `update_instruction` entry:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["kind", "stepId", "text", "title"],
  "properties": {
    "kind": { "const": "suggest_instruction" },
    "stepId": { "type": "string", "format": "uuid" },
    "text": { "type": "string", "minLength": 1, "maxLength": 2000 },
    "title": { "type": "string", "minLength": 1, "maxLength": 120 }
  }
}
```

Run: `bun run messages:generate && bun run messages:check`
Expected: validator regenerated, check passes.

Add to `apps/browser-extension/test/messages.test.ts` (follow the file's existing pattern for a valid `editor.command` message):

```ts
it('accepts a suggest_instruction editor command', () => {
  expect(
    parseIncomingMessage({
      kind: 'editor.command',
      payload: {
        commandId: '40000000-0000-4000-8000-000000000001',
        command: {
          kind: 'suggest_instruction',
          stepId: '20000000-0000-4000-8000-000000000001',
          text: 'Select the synthetic button.',
          title: 'Open the form',
        },
      },
    }),
  ).toBeDefined();
});
```

Run: `bun run vitest run apps/browser-extension/test/messages.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing Markdown heading test**

In `packages/atrium-client/test/atrium-client.test.ts`, find the existing test that calls `generateMarkdown` and add a sibling:

```ts
it('uses the suggested step title as the heading when present', () => {
  const session = publishableFixtureSession(); // reuse the file's existing publishable session helper
  const titled = {
    ...session,
    steps: session.steps.map((step, index) =>
      index === 0
        ? { ...step, instruction: { ...step.instruction, title: 'Open the form' } }
        : step,
    ),
  };
  const markdown = generateMarkdown(titled, readyJobFixture(), new MockAtriumGateway());
  expect(markdown).toContain('## Step 1: Open the form');
  expect(markdown).toContain('## Step 2\n');
});
```

Use the file's real helper names for the session and job fixtures; read the file first and substitute.

Run: `bun run vitest run packages/atrium-client/test/atrium-client.test.ts`
Expected: FAIL on the `## Step 1: Open the form` assertion.

- [ ] **Step 7: Implement the heading**

In `packages/atrium-client/src/index.ts` inside `generateMarkdown`, replace:

```ts
    lines.push(
      `## Step ${step.sequence + 1}`,
```

with:

```ts
    lines.push(
      step.instruction.title
        ? `## Step ${step.sequence + 1}: ${escapeMarkdown(step.instruction.title)}`
        : `## Step ${step.sequence + 1}`,
```

Run the test again. Expected: PASS.

- [ ] **Step 8: Write the failing Swift test**

Add to `apps/macos/Tests/AtriumCaptureCoreTests/NativePrivacyAndPublishingTests.swift`. That file has a private `makeSession(...)` helper near line 584 that builds an `AtriumCaptureSession` in code; read its parameters and call it so the session is in `.review` state with at least one step. The snippet below writes `makeReviewSession()` as a placeholder for that call:

```swift
    func testSuggestInstructionKeepsUserEditsAndMarksDistrictAI() throws {
        var session = makeReviewSession() // the file's existing helper name
        let stepID = session.steps[0].stepID
        session = try NativeReviewEditor.setInstruction(in: session, stepID: stepID, text: "My own words.")
        session = try NativeReviewEditor.suggestInstruction(
            in: session,
            stepID: stepID,
            text: "Select the synthetic button.",
            title: "Open the form"
        )

        let step = session.steps[0]
        XCTAssertEqual(step.instruction.editedText, "My own words.")
        XCTAssertEqual(step.instruction.userEdited, true)
        XCTAssertEqual(step.instruction.generatedText, "Select the synthetic button.")
        XCTAssertEqual(step.instruction.title, "Open the form")
        XCTAssertEqual(step.instruction.source, .districtAI)
    }

    func testSuggestInstructionRejectsBadInput() {
        let session = makeReviewSession()
        let stepID = session.steps[0].stepID
        XCTAssertThrowsError(try NativeReviewEditor.suggestInstruction(in: session, stepID: stepID, text: "  ", title: "T"))
        XCTAssertThrowsError(try NativeReviewEditor.suggestInstruction(in: session, stepID: stepID, text: "ok", title: String(repeating: "x", count: 121)))
        XCTAssertThrowsError(try NativeReviewEditor.suggestInstruction(in: session, stepID: "missing", text: "ok", title: "T"))
    }
```

Run: `bun run swift:test`
Expected: FAIL to compile (`suggestInstruction` missing).

- [ ] **Step 9: Implement the Swift command**

In `apps/macos/Sources/AtriumCaptureCore/NativeReviewEditor.swift` add after `setInstruction`:

```swift
    public static func suggestInstruction(
        in session: AtriumCaptureSession,
        stepID: String,
        text: String,
        title: String,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanText.isEmpty, cleanText.count <= 2_000 else {
            throw NativeReviewError.invalidInstruction
        }
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty, cleanTitle.count <= 120 else {
            throw NativeReviewError.invalidTitle
        }
        guard session.steps.contains(where: { $0.stepID == stepID }) else {
            throw NativeReviewError.stepNotFound
        }
        let steps = session.steps.map { step -> StepElement in
            guard step.stepID == stepID else { return step }
            return step.with(instruction: step.instruction.with(
                generatedText: cleanText,
                source: .districtAI,
                title: cleanTitle
            ))
        }
        return session.with(revision: session.revision + 1, steps: steps, updatedAt: now)
    }
```

Add `case invalidInstruction` to `NativeReviewError`. Check the generated `Instruction.with(...)` helper signature in `Contracts.swift` or `ContractSendability.swift`; if the `with` helper does not include `title`, extend the hand-written extension that defines it (not the generated file). This command deliberately bypasses `updateStep` so `privacyReview` and `state` are untouched.

Run: `bun run swift:test`
Expected: PASS.

- [ ] **Step 10: Swift Markdown uses the title when present**

The Mac publisher renders steps as a numbered list in `markdown(for:uploads:gateway:)` in `apps/macos/Sources/AtriumCaptureCore/NativePublishing.swift` (near line 935). Add a test first. Find the existing Markdown test in `NativePrivacyAndPublishingTests.swift` (search for `"## Steps"`) and add a sibling that sets `instruction.title` on the first step via `step.with(instruction: step.instruction.with(title: "Open the form"))` and asserts the rendered Markdown contains `1. **Open the form** `. Run `bun run swift:test` and confirm it fails.

Then in `markdown(for:uploads:gateway:)` replace:

```swift
            let raw = step.instruction.editedText ?? step.instruction.generatedText
            let escaped = raw
```

with:

```swift
            let raw = step.instruction.editedText ?? step.instruction.generatedText
            let heading = step.instruction.title.map { title in
                "**" + title.replacingOccurrences(of: "*", with: "\\*") + "** "
            } ?? ""
            let escaped = heading + raw
```

Keep the existing escaping chain applied to `escaped`. Run `bun run swift:test`. Expected: PASS.

- [ ] **Step 11: Format and commit**

```bash
bun run format && bun run lint && bun run typecheck
git add packages/editor-model packages/atrium-client apps/browser-extension/src/message.schema.json apps/browser-extension/src/generated apps/browser-extension/test/messages.test.ts apps/macos/Sources/AtriumCaptureCore/NativeReviewEditor.swift apps/macos/Sources/AtriumCaptureCore/NativePublishing.swift apps/macos/Tests/AtriumCaptureCoreTests
git commit -m "feat(editor): suggest_instruction command and titled step headings"
```

---

### Task 3: `packages/guide-writer` request builder, validator, and apply

**Files:**

- Create: `packages/guide-writer/package.json`
- Create: `packages/guide-writer/tsconfig.json`
- Create: `packages/guide-writer/README.md`
- Create: `packages/guide-writer/src/index.ts`
- Create: `packages/guide-writer/test/guide-writer.test.ts`

**Interfaces:**

- Consumes: `EditorCommand` and `canFinalizeReview` from `@atrium-capture/editor-model` (Task 2), `AtriumCaptureGuideSuggestion` from `@atrium-capture/contracts` (Task 1), `normalizeCaptureSourceOriginForPublication` from `@atrium-capture/atrium-client`.
- Produces:
  - `GUIDE_WRITER_REQUEST_LIMIT_BYTES = 131_072`
  - `interface GuideWriterRequest { schemaVersion: 1; sessionId: string; title: string; steps: GuideWriterRequestStep[] }`
  - `interface GuideWriterRequestStep { stepId: string; sequence: number; action: string; role?: string; accessibleName?: string; pageTitle?: string; origin?: string; appName?: string; windowTitle?: string; instruction: string }`
  - `buildGuideWriterRequest(session): GuideWriterRequest` (throws `Error('guide_request_too_large')`)
  - `serializeGuideWriterRequest(request): string` (JSON string, throws `guide_request_too_large` when over the byte limit)
  - `validateGuideSuggestion(value: unknown, session): AtriumCaptureGuideSuggestion` (throws `GuideSuggestionError` with `code` in `'suggestion_not_json' | 'suggestion_invalid' | 'suggestion_session_mismatch' | 'suggestion_unknown_step' | 'suggestion_missing_step'`)
  - `parseGuideSuggestionText(text: string): unknown` (strips one surrounding Markdown code fence, then `JSON.parse`; throws `GuideSuggestionError('suggestion_not_json')`)
  - `applyGuideSuggestion(session, suggestion): EditorCommand[]` (one `update_title` then one `suggest_instruction` per suggestion step in session order)
  - `class GuideSuggestionError extends Error { constructor(public readonly code: GuideSuggestionErrorCode, message?: string) }`

- [ ] **Step 1: Create the package scaffold**

`packages/guide-writer/package.json`:

```json
{
  "name": "@atrium-capture/guide-writer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "exports": "./src/index.ts",
  "dependencies": {
    "@atrium-capture/atrium-client": "workspace:*",
    "@atrium-capture/contracts": "workspace:*",
    "@atrium-capture/editor-model": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/guide-writer/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`packages/guide-writer/README.md`:

```markdown
# @atrium-capture/guide-writer

Builds the metadata-only request for the district "Capture Guide Writer"
assistant, validates its JSON reply against `contracts/guide-suggestion.schema.json`,
and converts the reply into editor commands. No DOM, Chrome, or AppKit.
The request never contains typed values, selectors, bounds, paths, asset
ids, or image bytes.
```

Run `bun install` from the repository root so the workspace link exists.

- [ ] **Step 2: Write the failing tests**

`packages/guide-writer/test/guide-writer.test.ts`:

````ts
import {
  Action,
  AssetState,
  AtriumCaptureSessionState,
  MIMEType,
  PrivacyReview,
  ReviewStatus,
  SchemaVersion,
  Source,
  SourceURLRetention,
  Surface,
  type AtriumCaptureSession,
} from '@atrium-capture/contracts';
import { applyEditorCommand } from '@atrium-capture/editor-model';
import { describe, expect, it } from 'vitest';

import {
  GUIDE_WRITER_REQUEST_LIMIT_BYTES,
  GuideSuggestionError,
  applyGuideSuggestion,
  buildGuideWriterRequest,
  parseGuideSuggestionText,
  serializeGuideWriterRequest,
  validateGuideSuggestion,
} from '../src/index.js';

const sessionId = '00000000-0000-4000-8000-000000000001';
const firstStepId = '10000000-0000-4000-8000-000000000001';
const secondStepId = '10000000-0000-4000-8000-000000000002';
const assetId = '20000000-0000-4000-8000-000000000001';

describe('buildGuideWriterRequest', () => {
  it('sends only step metadata and the current instruction text', () => {
    const request = buildGuideWriterRequest(fixtureSession());

    expect(request).toEqual({
      schemaVersion: 1,
      sessionId,
      steps: [
        {
          accessibleName: 'Synthetic label',
          action: 'input',
          instruction: 'Enter the requested value in Synthetic label.',
          origin: 'https://fixture.test',
          pageTitle: 'Synthetic form',
          role: 'textbox',
          sequence: 0,
          stepId: firstStepId,
        },
        {
          action: 'select',
          appName: 'Synthetic App',
          instruction: 'Choose an option in Synthetic destination.',
          sequence: 1,
          stepId: secondStepId,
          windowTitle: 'Synthetic window',
        },
      ],
      title: 'Synthetic guide',
    });
    const serialized = serializeGuideWriterRequest(request);
    expect(serialized).not.toContain(assetId);
    expect(serialized).not.toContain('selectors');
    expect(serialized).not.toContain('bounds');
    expect(serialized).not.toContain('/secret-path');
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain('typed-secret-value');
  });

  it('prefers the user-edited text as the current instruction', () => {
    const session = applyEditorCommand(fixtureSession(), {
      kind: 'update_instruction',
      stepId: firstStepId,
      text: 'My own words.',
    });
    const request = buildGuideWriterRequest(session);
    expect(request.steps[0]?.instruction).toBe('My own words.');
  });

  it('drops the origin when the session retains no source URL', () => {
    const session = fixtureSession();
    session.policy.sourceUrlRetention = SourceURLRetention.None;
    const request = buildGuideWriterRequest(session);
    expect(request.steps[0]?.origin).toBeUndefined();
    expect(request.steps[0]?.pageTitle).toBe('Synthetic form');
  });

  it('drops local-network origins even under origin retention', () => {
    const session = fixtureSession();
    const first = session.steps[0];
    if (first?.target?.browser) {
      first.target.browser.origin = 'http://10.0.0.5:8080';
    }
    expect(buildGuideWriterRequest(session).steps[0]?.origin).toBeUndefined();
  });

  it('rejects a request over the execute transport limit before serializing', () => {
    const session = fixtureSession();
    const padded = 'x'.repeat(1_900);
    session.steps = Array.from({ length: 80 }, (_, index) => ({
      ...session.steps[0]!,
      instruction: { generatedText: padded, source: Source.Rules, userEdited: false },
      sequence: index,
      stepId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    expect(() => serializeGuideWriterRequest(buildGuideWriterRequest(session))).toThrow(
      'guide_request_too_large',
    );
    expect(GUIDE_WRITER_REQUEST_LIMIT_BYTES).toBe(131_072);
  });
});

describe('validateGuideSuggestion', () => {
  it('accepts a suggestion that names every session step exactly once', () => {
    const suggestion = validateGuideSuggestion(fixtureSuggestion(), fixtureSession());
    expect(suggestion.title).toBe('Synthetic written guide');
  });

  it('rejects unknown, missing, or duplicate step ids as a whole', () => {
    const unknown = fixtureSuggestion();
    unknown.steps[1]!.stepId = '10000000-0000-4000-8000-000000000099';
    expect(() => validateGuideSuggestion(unknown, fixtureSession())).toThrow(
      expect.objectContaining({ code: 'suggestion_unknown_step' }),
    );

    const missing = fixtureSuggestion();
    missing.steps.pop();
    expect(() => validateGuideSuggestion(missing, fixtureSession())).toThrow(
      expect.objectContaining({ code: 'suggestion_missing_step' }),
    );

    const duplicate = fixtureSuggestion();
    duplicate.steps[1]!.stepId = firstStepId;
    expect(() => validateGuideSuggestion(duplicate, fixtureSession())).toThrow(
      expect.objectContaining({ code: 'suggestion_unknown_step' }),
    );
  });

  it('rejects a different session id, extra properties, and oversize text', () => {
    const otherSession = fixtureSuggestion();
    otherSession.sessionId = '00000000-0000-4000-8000-000000000002';
    expect(() => validateGuideSuggestion(otherSession, fixtureSession())).toThrow(
      expect.objectContaining({ code: 'suggestion_session_mismatch' }),
    );

    const extra = { ...fixtureSuggestion(), imageUrl: 'https://fixture.test/x.png' };
    expect(() => validateGuideSuggestion(extra, fixtureSession())).toThrow(
      expect.objectContaining({ code: 'suggestion_invalid' }),
    );

    const oversize = fixtureSuggestion();
    oversize.steps[0]!.instruction = 'x'.repeat(2_001);
    expect(() => validateGuideSuggestion(oversize, fixtureSession())).toThrow(
      expect.objectContaining({ code: 'suggestion_invalid' }),
    );
  });

  it('parses fenced and bare JSON text and rejects prose', () => {
    const json = JSON.stringify(fixtureSuggestion());
    expect(parseGuideSuggestionText(json)).toEqual(fixtureSuggestion());
    expect(parseGuideSuggestionText('```json\n' + json + '\n```')).toEqual(fixtureSuggestion());
    expect(() => parseGuideSuggestionText('Here is your guide:')).toThrow(GuideSuggestionError);
  });
});

describe('applyGuideSuggestion', () => {
  it('produces editor commands that keep user edits and replace generated text', () => {
    let session = applyEditorCommand(fixtureSession(), {
      kind: 'update_instruction',
      stepId: firstStepId,
      text: 'My own words.',
    });
    const commands = applyGuideSuggestion(session, fixtureSuggestion());
    expect(commands.map((command) => command.kind)).toEqual([
      'update_title',
      'suggest_instruction',
      'suggest_instruction',
    ]);
    for (const command of commands) {
      session = applyEditorCommand(session, command);
    }
    expect(session.title).toBe('Synthetic written guide');
    expect(session.steps[0]?.instruction.editedText).toBe('My own words.');
    expect(session.steps[0]?.instruction.userEdited).toBe(true);
    expect(session.steps[0]?.instruction.generatedText).toBe('Type the synthetic label.');
    expect(session.steps[0]?.instruction.title).toBe('Fill the label');
    expect(session.steps[1]?.instruction.source).toBe(Source.DistrictAI);
    expect(session.steps[1]?.instruction.userEdited).toBe(false);
  });
});

function fixtureSuggestion() {
  return {
    schemaVersion: 1,
    sessionId,
    steps: [
      { instruction: 'Type the synthetic label.', stepId: firstStepId, title: 'Fill the label' },
      {
        instruction: 'Choose the synthetic destination.',
        stepId: secondStepId,
        title: 'Pick a destination',
      },
    ],
    summary: 'Fill the synthetic form and pick a destination.',
    title: 'Synthetic written guide',
  };
}

function fixtureSession(): AtriumCaptureSession {
  return {
    assets: [
      {
        assetId,
        localKey: `sessions/synthetic/raw/${assetId}.png`,
        mimeType: MIMEType.ImagePNG,
        pixelHeight: 200,
        pixelWidth: 300,
        sha256: 'a'.repeat(64),
        state: AssetState.RawLocal,
      },
    ],
    createdAt: new Date(0),
    policy: {
      policyVersion: 'test-v1',
      reviewStatus: ReviewStatus.InReview,
      sourceUrlRetention: SourceURLRetention.Origin,
    },
    recorder: { appVersion: '0.1.0', surface: Surface.Browser },
    revision: 1,
    schemaVersion: SchemaVersion.The10,
    sessionId,
    state: AtriumCaptureSessionState.Review,
    steps: [
      {
        action: Action.Input,
        instruction: {
          generatedText: 'Enter the requested value in Synthetic label.',
          source: Source.Rules,
          userEdited: false,
        },
        occurredAt: new Date(1),
        privacyReview: PrivacyReview.Approved,
        screenshotAssetId: assetId,
        sequence: 0,
        stepId: firstStepId,
        target: {
          accessibleName: 'Synthetic label',
          bounds: { height: 20, width: 100, x: 10, y: 20 },
          browser: {
            devicePixelRatio: 2,
            origin: 'https://fixture.test',
            pageTitle: 'Synthetic form',
            path: '/secret-path',
            selectors: ['#typed-secret-value'],
            viewportCss: { height: 100, width: 150 },
          },
          role: 'textbox',
        },
      },
      {
        action: Action.Select,
        instruction: {
          generatedText: 'Choose an option in Synthetic destination.',
          source: Source.Rules,
          userEdited: false,
        },
        occurredAt: new Date(2),
        privacyReview: PrivacyReview.Approved,
        sequence: 1,
        stepId: secondStepId,
        target: {
          macos: {
            appName: 'Synthetic App',
            bundleId: 'test.synthetic',
            windowTitle: 'Synthetic window',
          },
        },
      },
    ],
    title: 'Synthetic guide',
    updatedAt: new Date(2),
  };
}
````

Before running, open `contracts/capture-session.schema.json` and confirm the exact property names under `target.browser` (`pageTitle`, `path`, `selectors`) and `target.macos` (`appName`, `bundleId`, `windowTitle`) and the type of `selectors`. Adjust the fixture to the real shape so the session is valid.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run vitest run packages/guide-writer`
Expected: FAIL, module `../src/index.js` not found.

- [ ] **Step 4: Implement the package**

`packages/guide-writer/src/index.ts`:

````ts
// ABOUTME: Builds the metadata-only Capture Guide Writer request, validates the assistant's
// ABOUTME: JSON reply against the shared contract, and converts it into editor commands.
import { normalizeCaptureSourceOriginForPublication } from '@atrium-capture/atrium-client';
import {
  SourceURLRetention,
  type AtriumCaptureGuideSuggestion,
  type AtriumCaptureSession,
  type StepElement,
} from '@atrium-capture/contracts';
import type { EditorCommand } from '@atrium-capture/editor-model';

export const GUIDE_WRITER_REQUEST_LIMIT_BYTES = 131_072;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_STEPS = 1_000;

export interface GuideWriterRequestStep {
  accessibleName?: string;
  action: string;
  appName?: string;
  instruction: string;
  origin?: string;
  pageTitle?: string;
  role?: string;
  sequence: number;
  stepId: string;
  windowTitle?: string;
}

export interface GuideWriterRequest {
  schemaVersion: 1;
  sessionId: string;
  steps: GuideWriterRequestStep[];
  title: string;
}

export type GuideSuggestionErrorCode =
  | 'suggestion_invalid'
  | 'suggestion_missing_step'
  | 'suggestion_not_json'
  | 'suggestion_session_mismatch'
  | 'suggestion_unknown_step';

export class GuideSuggestionError extends Error {
  constructor(
    public readonly code: GuideSuggestionErrorCode,
    message = code,
  ) {
    super(message);
    this.name = 'GuideSuggestionError';
  }
}

export function buildGuideWriterRequest(session: AtriumCaptureSession): GuideWriterRequest {
  const retainOrigin = session.policy.sourceUrlRetention !== SourceURLRetention.None;
  return {
    schemaVersion: 1,
    sessionId: session.sessionId,
    steps: [...session.steps]
      .sort((left, right) => left.sequence - right.sequence)
      .map((step) => requestStep(step, retainOrigin)),
    title: session.title,
  };
}

export function serializeGuideWriterRequest(request: GuideWriterRequest): string {
  const serialized = JSON.stringify(request);
  if (new TextEncoder().encode(serialized).byteLength > GUIDE_WRITER_REQUEST_LIMIT_BYTES) {
    throw new Error('guide_request_too_large');
  }
  return serialized;
}

export function parseGuideSuggestionText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    throw new GuideSuggestionError('suggestion_not_json');
  }
}

export function validateGuideSuggestion(
  value: unknown,
  session: AtriumCaptureSession,
): AtriumCaptureGuideSuggestion {
  const record = requireRecord(value, ['schemaVersion', 'sessionId', 'title', 'summary', 'steps']);
  if (record.schemaVersion !== 1) {
    throw new GuideSuggestionError('suggestion_invalid', 'schemaVersion must be 1');
  }
  const suggestionSessionId = requireText(record.sessionId, 1, 36, 'sessionId');
  if (!UUID_PATTERN.test(suggestionSessionId)) {
    throw new GuideSuggestionError('suggestion_invalid', 'sessionId must be a uuid');
  }
  if (suggestionSessionId !== session.sessionId) {
    throw new GuideSuggestionError('suggestion_session_mismatch');
  }
  const title = requireText(record.title, 1, 200, 'title');
  const summary = requireText(record.summary, 1, 600, 'summary');
  if (!Array.isArray(record.steps) || record.steps.length < 1 || record.steps.length > MAX_STEPS) {
    throw new GuideSuggestionError('suggestion_invalid', 'steps must be a non-empty array');
  }
  const sessionStepIds = new Set(session.steps.map((step) => step.stepId));
  const seen = new Set<string>();
  const steps = record.steps.map((entry) => {
    const stepRecord = requireRecord(entry, ['stepId', 'title', 'instruction']);
    const stepId = requireText(stepRecord.stepId, 1, 36, 'stepId');
    if (!sessionStepIds.has(stepId) || seen.has(stepId)) {
      throw new GuideSuggestionError(
        'suggestion_unknown_step',
        `unknown or repeated step ${stepId}`,
      );
    }
    seen.add(stepId);
    return {
      instruction: requireText(stepRecord.instruction, 1, 2_000, 'instruction'),
      stepId,
      title: requireText(stepRecord.title, 1, 120, 'step title'),
    };
  });
  for (const stepId of sessionStepIds) {
    if (!seen.has(stepId)) {
      throw new GuideSuggestionError('suggestion_missing_step', `missing step ${stepId}`);
    }
  }
  return { schemaVersion: 1, sessionId: suggestionSessionId, steps, summary, title };
}

export function applyGuideSuggestion(
  session: AtriumCaptureSession,
  suggestion: AtriumCaptureGuideSuggestion,
): EditorCommand[] {
  const byStepId = new Map(suggestion.steps.map((step) => [step.stepId, step]));
  const commands: EditorCommand[] = [{ kind: 'update_title', title: suggestion.title }];
  for (const step of [...session.steps].sort((left, right) => left.sequence - right.sequence)) {
    const suggested = byStepId.get(step.stepId);
    if (!suggested) {
      throw new GuideSuggestionError('suggestion_missing_step', `missing step ${step.stepId}`);
    }
    commands.push({
      kind: 'suggest_instruction',
      stepId: step.stepId,
      text: suggested.instruction,
      title: suggested.title,
    });
  }
  return commands;
}

function requestStep(step: StepElement, retainOrigin: boolean): GuideWriterRequestStep {
  const browser = step.target?.browser;
  const macos = step.target?.macos;
  const origin =
    retainOrigin && browser?.origin
      ? normalizeCaptureSourceOriginForPublication(browser.origin)
      : undefined;
  return {
    action: step.action,
    instruction: step.instruction.editedText ?? step.instruction.generatedText,
    sequence: step.sequence,
    stepId: step.stepId,
    ...optional('role', step.target?.role),
    ...optional('accessibleName', step.target?.accessibleName),
    ...optional('pageTitle', browser?.pageTitle),
    ...optional('origin', origin),
    ...optional('appName', macos?.appName),
    ...optional('windowTitle', macos?.windowTitle),
  };
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  const trimmed = value?.trim();
  return trimmed ? ({ [key]: trimmed } as Record<K, string>) : {};
}

function requireRecord(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GuideSuggestionError('suggestion_invalid', 'expected an object');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      throw new GuideSuggestionError('suggestion_invalid', `unexpected property ${key}`);
    }
  }
  for (const key of allowedKeys) {
    if (!(key in record)) {
      throw new GuideSuggestionError('suggestion_invalid', `missing property ${key}`);
    }
  }
  return record;
}

function requireText(value: unknown, min: number, max: number, label: string): string {
  if (typeof value !== 'string') {
    throw new GuideSuggestionError('suggestion_invalid', `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new GuideSuggestionError('suggestion_invalid', `${label} length out of range`);
  }
  return trimmed;
}
````

Match the generated enum and property names from `contracts.ts` (`step.action` is the `Action` enum whose string values are the schema strings; `step.target?.accessibleName` and `browser.pageTitle` exist only if the schema defines them; read `Target`, `Browser`, and `Macos` in the generated file and adjust).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run vitest run packages/guide-writer && bun run --filter '@atrium-capture/guide-writer' typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Lint, format, commit**

```bash
bun run format && bun run lint
git add packages/guide-writer bun.lock
git commit -m "feat(guide-writer): metadata-only request, suggestion validation, apply commands"
```

If `bun.lock` did not change, omit it.

---

### Task 4: `executeGuideWriter` on the TypeScript Atrium gateways

**Files:**

- Modify: `packages/atrium-client/src/index.ts:14-23` (`AtriumCapabilities`), `:75-92` (`AtriumGateway`), `:122-140` (`UnavailableAtriumGateway`)
- Modify: `packages/atrium-client/src/live-gateway.ts:23-31` (scopes), `:96-120` (capabilities), new method, `sendApiJson`/`getApiJson` reuse
- Modify: `packages/atrium-client/src/mock-gateway.ts:64-92`
- Modify: `packages/atrium-client/src/http-mock-gateway.ts` (`parseCapabilities` and a new method)
- Modify: `packages/atrium-client/src/mock-server.ts` (new route)
- Modify: `packages/atrium-client/test/live-gateway.test.ts`
- Modify: `packages/atrium-client/test/atrium-client.test.ts` (mock gateway test)
- Modify: `scripts/verify-atrium-production-boundary.mjs` and any other script that lists `ATRIUM_OAUTH_SCOPES` or the capability keys (grep for `internalPublication:` and `content:publish_internal` outside `packages/`).

**Interfaces:**

- Produces:
  - `AtriumCapabilities.guideWriter: boolean`
  - `interface ExecuteGuideWriterRequest { assistantId: number; steps: string; signal?: AbortSignal }`
  - `interface ExecuteGuideWriterResult { jobId: string; text: string }`
  - `AtriumGateway.executeGuideWriter(request: ExecuteGuideWriterRequest): Promise<ExecuteGuideWriterResult>`
  - `GatewayError` codes: `atrium_guide_writer_unavailable` (not retryable), `atrium_job_failed` (retryable), `atrium_job_cancelled` (retryable), `atrium_job_timeout` (retryable), `atrium_response_invalid` (not retryable), existing HTTP mapping for 403 (`atrium_http_403` or the server's `error.code`, not retryable).
  - Constants exported from `live-gateway.ts`: `GUIDE_WRITER_BUDGET_MS = 120_000`, `GUIDE_WRITER_POLL_MIN_MS = 1_000`, `GUIDE_WRITER_POLL_MAX_MS = 10_000`.
  - `MockAtriumGateway` options gain `guideWriter?: { text?: string; fail?: 'failed' | 'cancelled' | 'forbidden' }`. Default text is a valid suggestion built from the steps JSON it receives (title "Synthetic written guide", each step title "Step N", instruction = the request's instruction with " (AI)" appended).

- [ ] **Step 1: Write the failing production gateway tests**

Append to `packages/atrium-client/test/live-gateway.test.ts` inside the outer `describe`:

```ts
it('requests the execute scope', async () => {
  const { ATRIUM_OAUTH_SCOPES } = await import('../src/live-gateway.js');
  expect(ATRIUM_OAUTH_SCOPES).toContain('assistants:execute');
});

it('executes the guide writer assistant and polls the job to completion', async () => {
  const calls: Array<{ body?: unknown; headers: Headers; method: string; url: string }> = [];
  let polls = 0;
  const gateway = new ProductionAtriumGateway({
    accessToken: async () => 'synthetic-access-token',
    configured: async () => true,
    request: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body;
      calls.push({ ...(body === undefined ? {} : { body }), headers, method, url });
      if (url.endsWith('/api/v1/assistants/42/execute') && method === 'POST') {
        return json(
          { data: { jobId: 'job-1', pollUrl: '/api/v1/jobs/job-1', status: 'pending' } },
          202,
        );
      }
      if (url.endsWith('/api/v1/jobs/job-1') && method === 'GET') {
        polls += 1;
        if (polls < 2) {
          return json({
            data: { pollingInterval: 1, shouldContinuePolling: true, status: 'processing' },
          });
        }
        return json({
          data: {
            partialContent: '',
            pollingInterval: 1,
            responseData: { text: '{"schemaVersion":1}' },
            shouldContinuePolling: false,
            status: 'completed',
          },
        });
      }
      return json({ error: { code: 'not_found' } }, 404);
    },
    sleep: async () => undefined,
  });

  const result = await gateway.executeGuideWriter({
    assistantId: 42,
    steps: '{"schemaVersion":1,"steps":[]}',
  });

  expect(result).toEqual({ jobId: 'job-1', text: '{"schemaVersion":1}' });
  const execute = calls[0];
  expect(execute?.headers.get('accept')).toBe('application/json');
  expect(execute?.headers.get('authorization')).toBe('Bearer synthetic-access-token');
  expect(execute?.body).toEqual({ inputs: { steps: '{"schemaVersion":1,"steps":[]}' } });
  expect(polls).toBe(2);
});

it('maps failed and cancelled jobs to retryable gateway errors', async () => {
  for (const status of ['failed', 'cancelled'] as const) {
    const gateway = new ProductionAtriumGateway({
      accessToken: async () => 'synthetic-access-token',
      configured: async () => true,
      request: async (input, init) => {
        const url = String(input);
        if (init?.method === 'POST') {
          return json({ data: { jobId: 'job-2', status: 'pending' } }, 202);
        }
        if (url.endsWith('/api/v1/jobs/job-2')) {
          return json({ data: { errorMessage: 'synthetic', status } });
        }
        return json({ error: { code: 'not_found' } }, 404);
      },
      sleep: async () => undefined,
    });
    await expect(
      gateway.executeGuideWriter({ assistantId: 42, steps: '{}' }),
    ).rejects.toMatchObject({ code: `atrium_job_${status}`, retryable: true });
  }
});

it('surfaces a 403 on execute as a non-retryable error without polling', async () => {
  let polled = false;
  const gateway = new ProductionAtriumGateway({
    accessToken: async () => 'synthetic-access-token',
    configured: async () => true,
    request: async (_input, init) => {
      if (init?.method === 'POST') {
        return json({ error: { code: 'insufficient_scope', message: 'nope' } }, 403);
      }
      polled = true;
      return json({});
    },
    sleep: async () => undefined,
  });
  await expect(gateway.executeGuideWriter({ assistantId: 42, steps: '{}' })).rejects.toMatchObject({
    code: 'insufficient_scope',
    retryable: false,
  });
  expect(polled).toBe(false);
});

it('aborts polling when the overall budget is exhausted', async () => {
  let now = 0;
  const gateway = new ProductionAtriumGateway({
    accessToken: async () => 'synthetic-access-token',
    clock: () => now,
    configured: async () => true,
    request: async (_input, init) => {
      if (init?.method === 'POST') {
        return json({ data: { jobId: 'job-3', status: 'pending' } }, 202);
      }
      return json({ data: { pollingInterval: 10_000, status: 'processing' } });
    },
    sleep: async (ms) => {
      now += ms;
    },
  });
  await expect(gateway.executeGuideWriter({ assistantId: 42, steps: '{}' })).rejects.toMatchObject({
    code: 'atrium_job_timeout',
    retryable: true,
  });
  expect(now).toBeGreaterThanOrEqual(120_000);
});

it('clamps the server polling interval to the documented range', async () => {
  const sleeps: number[] = [];
  let polls = 0;
  const gateway = new ProductionAtriumGateway({
    accessToken: async () => 'synthetic-access-token',
    configured: async () => true,
    request: async (_input, init) => {
      if (init?.method === 'POST') {
        return json({ data: { jobId: 'job-4', status: 'pending' } }, 202);
      }
      polls += 1;
      if (polls === 1) {
        return json({ data: { pollingInterval: 50, status: 'processing' } });
      }
      if (polls === 2) {
        return json({ data: { pollingInterval: 60_000, status: 'processing' } });
      }
      return json({ data: { responseData: { text: 'ok' }, status: 'completed' } });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  await gateway.executeGuideWriter({ assistantId: 42, steps: '{}' });
  expect(sleeps).toEqual([1_000, 10_000]);
});
```

Note the first poll happens after one sleep of the clamped interval from the 202 body (default 1000 ms when absent). If the test's expected `sleeps` differs after reading the implementation below, keep the implementation's documented behaviour: sleep before every poll, using the most recent server interval clamped to 1000 to 10000 ms.

The `json(body, status)` helper already exists at the bottom of that test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run packages/atrium-client/test/live-gateway.test.ts`
Expected: FAIL. `executeGuideWriter` is not a function; `sleep` and `clock` are unknown options under `exactOptionalPropertyTypes`.

- [ ] **Step 3: Extend the interfaces in `index.ts`**

In `AtriumCapabilities` add `guideWriter: boolean;` after `contentUpdates`. Add after `CreatePublishJobOptions`:

```ts
export interface ExecuteGuideWriterRequest {
  assistantId: number;
  signal?: AbortSignal;
  steps: string;
}

export interface ExecuteGuideWriterResult {
  jobId: string;
  text: string;
}
```

In `AtriumGateway` add after `createPrivateObject`:

```ts
  executeGuideWriter(request: ExecuteGuideWriterRequest): Promise<ExecuteGuideWriterResult>;
```

In `UnavailableAtriumGateway.capabilities()` add `guideWriter: false,` and add:

```ts
  async executeGuideWriter(): Promise<ExecuteGuideWriterResult> {
    throw new GatewayError('atrium_guide_writer_unavailable', false);
  }
```

Search `index.ts` for every other object literal that builds `AtriumCapabilities` (for example in `DurablePublisher` tests or helpers) and add `guideWriter`. Run `bun run typecheck` to find each site the compiler flags, including `apps/browser-extension/test/publication-service.test.ts` and any `capabilities:` literals in extension tests.

- [ ] **Step 4: Implement the production gateway method**

In `live-gateway.ts`:

Add `'assistants:execute',` to `ATRIUM_OAUTH_SCOPES` after `'content:publish_internal'`.

Add constants after `ASSET_UPLOAD_TIMEOUT_MS`:

```ts
export const GUIDE_WRITER_BUDGET_MS = 120_000;
export const GUIDE_WRITER_POLL_MIN_MS = 1_000;
export const GUIDE_WRITER_POLL_MAX_MS = 10_000;
```

Add to `ProductionAtriumGatewayOptions`:

```ts
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
```

Add private fields and defaults in the constructor:

```ts
  private readonly clock: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  // in constructor:
    this.clock = options.clock ?? (() => Date.now());
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
```

In both `capabilities()` return objects add `guideWriter: false` (unconfigured) and `guideWriter: true` (live).

Add the method after `createPrivateObject`:

```ts
  async executeGuideWriter(request: ExecuteGuideWriterRequest): Promise<ExecuteGuideWriterResult> {
    if (!Number.isInteger(request.assistantId) || request.assistantId <= 0) {
      throw new GatewayError('atrium_assistant_id_invalid', false);
    }
    const startedAt = this.clock();
    const accepted = requireRecord(
      requireRecord(
        await this.sendApiJson(`/assistants/${request.assistantId}/execute`, {
          inputs: { steps: request.steps },
        }),
      ).data,
    );
    const jobId = typeof accepted.jobId === 'string' ? accepted.jobId : undefined;
    if (!jobId || jobId.length > 200) {
      throw new GatewayError('atrium_response_invalid', false);
    }
    let interval = clampPollInterval(accepted.pollingInterval);
    for (;;) {
      if (this.clock() - startedAt + interval > GUIDE_WRITER_BUDGET_MS) {
        throw new GatewayError('atrium_job_timeout', true);
      }
      request.signal?.throwIfAborted();
      await this.sleep(interval);
      const job = requireRecord(
        requireRecord(await this.getApiJson(`/jobs/${encodeURIComponent(jobId)}`)).data,
      );
      const status = typeof job.status === 'string' ? job.status : '';
      if (status === 'completed') {
        return { jobId, text: completedText(job) };
      }
      if (status === 'failed' || status === 'cancelled') {
        const message =
          typeof job.errorMessage === 'string' ? job.errorMessage.slice(0, 1_000) : undefined;
        throw new GatewayError(`atrium_job_${status}`, true, message);
      }
      if (status !== 'pending' && status !== 'processing' && status !== 'streaming') {
        throw new GatewayError('atrium_response_invalid', false);
      }
      interval = clampPollInterval(job.pollingInterval);
    }
  }
```

Module-level helpers (next to `parseApiResponse`):

```ts
function clampPollInterval(value: unknown): number {
  const milliseconds =
    typeof value === 'number' && Number.isFinite(value) ? value : GUIDE_WRITER_POLL_MIN_MS;
  return Math.min(GUIDE_WRITER_POLL_MAX_MS, Math.max(GUIDE_WRITER_POLL_MIN_MS, milliseconds));
}

function completedText(job: Record<string, unknown>): string {
  const responseData =
    job.responseData && typeof job.responseData === 'object'
      ? (job.responseData as Record<string, unknown>)
      : {};
  const candidates = [responseData.text, responseData.content, job.partialContent];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      if (candidate.length > MAX_JSON_RESPONSE_BYTES) {
        throw new GatewayError('atrium_response_too_large', false);
      }
      return candidate;
    }
  }
  throw new GatewayError('atrium_response_invalid', false, 'Completed job carried no text.');
}
```

`pollingInterval` is documented as milliseconds in the aistudio OpenAPI description of `GET /api/v1/jobs/{jobId}` ("Recommended polling interval in milliseconds"). Clamp it as milliseconds.

`requireRecord` already exists in `live-gateway.ts`; reuse it. Import `ExecuteGuideWriterRequest` and `ExecuteGuideWriterResult` from `./index.js`.

- [ ] **Step 5: Run the production tests to verify they pass**

Run: `bun run vitest run packages/atrium-client/test/live-gateway.test.ts`
Expected: PASS.

- [ ] **Step 6: Mock gateways and mock server**

In `mock-gateway.ts`:

Add to `MockAtriumGatewayOptions`:

```ts
  guideWriter?: { fail?: 'cancelled' | 'failed' | 'forbidden'; text?: string };
```

Store it as `private readonly guideWriter: MockAtriumGatewayOptions['guideWriter'];` in the constructor. Add `guideWriter: true,` to `capabilities()`. Add the method:

```ts
  async executeGuideWriter(request: ExecuteGuideWriterRequest): Promise<ExecuteGuideWriterResult> {
    const jobId = `mock-job-${this.sequence++}`;
    if (this.guideWriter?.fail === 'forbidden') {
      throw new GatewayError('insufficient_scope', false, 'Mock token lacks assistants:execute.');
    }
    if (this.guideWriter?.fail) {
      throw new GatewayError(`atrium_job_${this.guideWriter.fail}`, true);
    }
    if (this.guideWriter?.text !== undefined) {
      return { jobId, text: this.guideWriter.text };
    }
    const parsed = JSON.parse(request.steps) as {
      sessionId: string;
      steps: Array<{ instruction: string; sequence: number; stepId: string }>;
    };
    return {
      jobId,
      text: JSON.stringify({
        schemaVersion: 1,
        sessionId: parsed.sessionId,
        steps: parsed.steps.map((step) => ({
          instruction: `${step.instruction} (AI)`,
          stepId: step.stepId,
          title: `Step ${step.sequence + 1}`,
        })),
        summary: 'Synthetic summary written by the mock guide writer.',
        title: 'Synthetic written guide',
      }),
    };
  }
```

In `http-mock-gateway.ts`, add `guideWriter: requireBoolean(record, 'guideWriter'),` to `parseCapabilities` and:

```ts
  async executeGuideWriter(request: ExecuteGuideWriterRequest): Promise<ExecuteGuideWriterResult> {
    return this.sendJson(
      `/assistants/${encodeURIComponent(String(request.assistantId))}/execute`,
      { steps: request.steps },
      parseGuideWriterResult,
    );
  }
```

with

```ts
function parseGuideWriterResult(value: unknown): ExecuteGuideWriterResult {
  const record = requireRecord(value);
  return { jobId: requireString(record, 'jobId'), text: requireString(record, 'text') };
}
```

In `mock-server.ts` add a route after the `/objects` POST:

```ts
const executeMatch = /^\/assistants\/([^/]+)\/execute$/.exec(relativePath);
if (request.method === 'POST' && executeMatch?.[1]) {
  const body = requireRecord(await readJson(request));
  const result = await gateway.executeGuideWriter({
    assistantId: Number(decodeURIComponent(executeMatch[1])),
    steps: requireString(body, 'steps'),
  });
  return json(response, 200, result);
}
```

Add a test to `packages/atrium-client/test/atrium-client.test.ts`:

```ts
it('mock gateway writes a suggestion for every requested step', async () => {
  const gateway = new MockAtriumGateway();
  const result = await gateway.executeGuideWriter({
    assistantId: 1,
    steps: JSON.stringify({
      schemaVersion: 1,
      sessionId: '00000000-0000-4000-8000-000000000001',
      steps: [{ instruction: 'Select Start.', sequence: 0, stepId: 'step-a' }],
      title: 'Guide',
    }),
  });
  expect(JSON.parse(result.text)).toMatchObject({
    schemaVersion: 1,
    sessionId: '00000000-0000-4000-8000-000000000001',
    steps: [{ instruction: 'Select Start. (AI)', stepId: 'step-a', title: 'Step 1' }],
  });
  await expect(
    new MockAtriumGateway({ guideWriter: { fail: 'failed' } }).executeGuideWriter({
      assistantId: 1,
      steps: '{}',
    }),
  ).rejects.toMatchObject({ code: 'atrium_job_failed', retryable: true });
});
```

Add a round-trip assertion to `packages/atrium-client/test/mock-http.test.ts` following its existing pattern: start the mock server, call `executeGuideWriter` through `HttpMockAtriumGateway`, and expect `text` to parse as JSON with `schemaVersion: 1`.

- [ ] **Step 7: Run every atrium-client test and typecheck the workspace**

Run: `bun run vitest run packages/atrium-client && bun run typecheck`
Expected: PASS. Fix each `AtriumCapabilities` literal the compiler flags (search `internalPublication:` across `apps/` and `scripts/`) by adding `guideWriter`.

- [ ] **Step 8: Update the boundary scripts and docs that list scopes**

Run `grep -rn "content:publish_internal" --include=*.mjs --include=*.md --include=*.ts --include=*.swift . | grep -v node_modules | grep -v Generated`. For each script that asserts the scope list (for example `scripts/verify-atrium-production-boundary.mjs`), add `assistants:execute`. For each doc that lists scopes (`docs/atrium-integration.md`, `docs/browser-managed-policy.md`, `docs/macos-runbook.md`), add `assistants:execute` with the note "used only by the AI guide writer".

- [ ] **Step 9: Format, lint, commit**

```bash
bun run format && bun run lint && bun run typecheck && bun run test
git add packages/atrium-client apps scripts docs
git commit -m "feat(atrium-client): executeGuideWriter with execute-and-poll on every gateway"
```

Review `git status` before `git add apps scripts docs`; stage only the files you changed.

---

### Task 5: Browser extension policy, service, message, and button

**Files:**

- Modify: `apps/browser-extension/src/managed-policy.ts` (`RuntimeManagedPolicy`, `allowedKeys`, `defaults`, `parseManagedPolicy`)
- Modify: `apps/browser-extension/test/managed-policy.test.ts`
- Create: `apps/browser-extension/src/guide-writer-service.ts`
- Create: `apps/browser-extension/test/guide-writer-service.test.ts`
- Modify: `apps/browser-extension/src/messages.ts` (new `EditorWriteGuideMessage`, union, parser)
- Modify: `apps/browser-extension/src/message.schema.json` (new `editor.write-guide` message) and regenerate
- Modify: `apps/browser-extension/test/messages.test.ts`
- Modify: `apps/browser-extension/entrypoints/background.ts` (wire service, new `case`)
- Modify: `apps/browser-extension/src/diagnostics-service.ts` (`managedPolicy.aiGuideWriting`, `guideWriterConfigured`)
- Modify: `apps/browser-extension/entrypoints/sidepanel/App.tsx` (button in the review section near line 908)
- Modify: `apps/browser-extension/src/database.ts` (`HealthEventCode` union gains `guide_writer_failed`)
- Modify: `apps/browser-extension/test/extension/recorder.pw.ts` (gating assertion)
- Modify: `docs/browser-managed-policy.md`

**Interfaces:**

- Consumes: `buildGuideWriterRequest`, `serializeGuideWriterRequest`, `parseGuideSuggestionText`, `validateGuideSuggestion`, `applyGuideSuggestion`, `GuideSuggestionError` (Task 3); `AtriumGateway.executeGuideWriter`, `capabilities().guideWriter`, `GatewayError` (Task 4); `EditorService.command` (existing).
- Produces:
  - `RuntimeManagedPolicy.aiGuideWriting: 'off' | 'on'` (default `'on'`) and `RuntimeManagedPolicy.atriumGuideWriterAssistantId?: number`.
  - `class GuideWriterService { constructor(repository: CaptureRepository, editor: EditorService, gateway: AtriumGateway, policy: () => Promise<ManagedPolicySnapshot>) ; availability(): Promise<GuideWriterAvailability>; write(commandId: string): Promise<GuideWriterOutcome> }`
  - `type GuideWriterAvailability = { available: true } | { available: false; reason: 'policy_off' | 'assistant_unconfigured' | 'gateway_unavailable' }`
  - `type GuideWriterOutcome = { ok: true; session: AtriumCaptureSession } | { ok: false; errorCode: string; retryable: boolean }`
  - Message `{ kind: 'editor.write-guide'; payload: { commandId: string } }` returns `GuideWriterOutcome`.
  - `SupportDiagnostics.managedPolicy.aiGuideWriting: string` and `SupportDiagnostics.managedPolicy.guideWriterConfigured: boolean`.
  - `PublicationSnapshot` is unchanged; the side panel reads `publication.capabilities.guideWriter` from the existing `publisher.snapshot` message.

- [ ] **Step 1: Managed policy keys, test first**

Add to `apps/browser-extension/test/managed-policy.test.ts`:

```ts
it('defaults AI guide writing on with no assistant configured', () => {
  const snapshot = parseManagedPolicy({});
  expect(snapshot.policy.aiGuideWriting).toBe('on');
  expect(snapshot.policy.atriumGuideWriterAssistantId).toBeUndefined();
});

it('accepts the guide writer policy keys and rejects bad values', () => {
  expect(
    parseManagedPolicy({
      aiGuideWriting: 'off',
      atriumGuideWriterAssistantId: 42,
      schemaVersion: 1,
    }).policy,
  ).toMatchObject({ aiGuideWriting: 'off', atriumGuideWriterAssistantId: 42 });
  expect(parseManagedPolicy({ aiGuideWriting: 'maybe', schemaVersion: 1 }).issues).toContain(
    'ai_guide_writing_invalid',
  );
  expect(
    parseManagedPolicy({ atriumGuideWriterAssistantId: 0, schemaVersion: 1 }).issues,
  ).toContain('atrium_guide_writer_assistant_id_invalid');
  expect(
    parseManagedPolicy({ atriumGuideWriterAssistantId: '42', schemaVersion: 1 }).issues,
  ).toContain('atrium_guide_writer_assistant_id_invalid');
});
```

Run: `bun run vitest run apps/browser-extension/test/managed-policy.test.ts`. Expected: FAIL.

Implement in `managed-policy.ts`:

- `RuntimeManagedPolicy` gains `aiGuideWriting: 'off' | 'on';` and `atriumGuideWriterAssistantId?: number;`.
- `allowedKeys` gains `'aiGuideWriting'` and `'atriumGuideWriterAssistantId'`.
- `defaults` gains `aiGuideWriting: 'on',`.
- In `parseManagedPolicy`, after `atriumOAuthClientId`:

```ts
const aiGuideWriting = parseEnum(
  record.aiGuideWriting,
  ['on', 'off'] as const,
  defaults.aiGuideWriting,
  'ai_guide_writing_invalid',
  issues,
);
const atriumGuideWriterAssistantId = parseOptionalPositiveInteger(
  record.atriumGuideWriterAssistantId,
  'atrium_guide_writer_assistant_id_invalid',
  issues,
);
```

Read `parseEnum`'s real signature near line 219 and match its argument order. Add the result to the returned `policy` object (`aiGuideWriting,` and `...(atriumGuideWriterAssistantId ? { atriumGuideWriterAssistantId } : {})`) and to `invalidPolicy` (`aiGuideWriting: 'off'`, so an invalid policy disables the feature). Add the helper:

```ts
function parseOptionalPositiveInteger(
  value: unknown,
  issue: string,
  issues: string[],
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    issues.push(issue);
    return undefined;
  }
  return value;
}
```

Run the test again. Expected: PASS.

- [ ] **Step 2: Guide writer service, test first**

`apps/browser-extension/test/guide-writer-service.test.ts`:

```ts
import { MockAtriumGateway } from '@atrium-capture/atrium-client/mock';
import { Source } from '@atrium-capture/contracts';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

import { CaptureRepository } from '../src/database.js';
import { EditorService } from '../src/editor-service.js';
import { GuideWriterService } from '../src/guide-writer-service.js';
import { parseManagedPolicy, type ManagedPolicySnapshot } from '../src/managed-policy.js';

const repository = new CaptureRepository(`atrium-guide-writer-${crypto.randomUUID()}`);
const editor = new EditorService(repository, async () => undefined);

afterEach(async () => {
  await repository.deleteForTests();
});

function policy(overrides: Record<string, unknown> = {}): () => Promise<ManagedPolicySnapshot> {
  return async () =>
    parseManagedPolicy({ atriumGuideWriterAssistantId: 42, schemaVersion: 1, ...overrides });
}

async function reviewedSession(): Promise<string> {
  await repository.startSession('Synthetic guide', '0.1.0');
  const session = await repository.getActiveSession();
  await repository.recordStep(/* use the same helper the editor-service test uses to add a step */);
  await repository.transition('stop');
  await editor.command(crypto.randomUUID(), { kind: 'approve_clear_steps' });
  return session!.sessionId;
}

describe('guide writer service', () => {
  it('reports why the writer is unavailable', async () => {
    const gateway = new MockAtriumGateway();
    expect(
      await new GuideWriterService(
        repository,
        editor,
        gateway,
        policy({ aiGuideWriting: 'off' }),
      ).availability(),
    ).toEqual({ available: false, reason: 'policy_off' });
    expect(
      await new GuideWriterService(repository, editor, gateway, async () =>
        parseManagedPolicy({ schemaVersion: 1 }),
      ).availability(),
    ).toEqual({ available: false, reason: 'assistant_unconfigured' });
    expect(
      await new GuideWriterService(repository, editor, gateway, policy()).availability(),
    ).toEqual({ available: true });
  });

  it('refuses to call the gateway when policy is off even if asked', async () => {
    await reviewedSession();
    let executed = false;
    const gateway = new MockAtriumGateway();
    const original = gateway.executeGuideWriter.bind(gateway);
    gateway.executeGuideWriter = async (request) => {
      executed = true;
      return original(request);
    };
    const service = new GuideWriterService(
      repository,
      editor,
      gateway,
      policy({ aiGuideWriting: 'off' }),
    );
    expect(await service.write(crypto.randomUUID())).toMatchObject({
      ok: false,
      errorCode: 'policy_off',
    });
    expect(executed).toBe(false);
  });

  it('writes a suggestion into the reviewed session and keeps user edits', async () => {
    const sessionId = await reviewedSession();
    const before = await repository.getActiveSession();
    const firstStepId = before!.steps[0]!.stepId;
    await editor.command(crypto.randomUUID(), {
      kind: 'update_instruction',
      stepId: firstStepId,
      text: 'My own words.',
    });
    const service = new GuideWriterService(repository, editor, new MockAtriumGateway(), policy());

    const outcome = await service.write(crypto.randomUUID());

    expect(outcome.ok).toBe(true);
    const after = await repository.getActiveSession();
    expect(after?.sessionId).toBe(sessionId);
    expect(after?.title).toBe('Synthetic written guide');
    expect(after?.steps[0]?.instruction.editedText).toBe('My own words.');
    expect(after?.steps[0]?.instruction.source).toBe(Source.DistrictAI);
    expect(after?.steps[0]?.instruction.title).toBe('Step 1');
  });

  it('leaves the session unchanged and reports a retryable error when the job fails', async () => {
    await reviewedSession();
    const before = await repository.getActiveSession();
    const service = new GuideWriterService(
      repository,
      editor,
      new MockAtriumGateway({ guideWriter: { fail: 'failed' } }),
      policy(),
    );
    expect(await service.write(crypto.randomUUID())).toEqual({
      errorCode: 'atrium_job_failed',
      ok: false,
      retryable: true,
    });
    expect(await repository.getActiveSession()).toEqual(before);
    expect((await repository.listHealthEvents()).map((event) => event.code)).toContain(
      'guide_writer_failed',
    );
  });

  it('rejects an invalid suggestion without applying any command', async () => {
    await reviewedSession();
    const before = await repository.getActiveSession();
    const service = new GuideWriterService(
      repository,
      editor,
      new MockAtriumGateway({ guideWriter: { text: '{"schemaVersion":1,"steps":[]}' } }),
      policy(),
    );
    expect(await service.write(crypto.randomUUID())).toMatchObject({
      errorCode: 'suggestion_invalid',
      ok: false,
      retryable: true,
    });
    expect(await repository.getActiveSession()).toEqual(before);
  });

  it('treats a 403 as policy off for the rest of the session', async () => {
    await reviewedSession();
    const service = new GuideWriterService(
      repository,
      editor,
      new MockAtriumGateway({ guideWriter: { fail: 'forbidden' } }),
      policy(),
    );
    expect(await service.write(crypto.randomUUID())).toMatchObject({ ok: false, retryable: false });
    expect(await service.availability()).toEqual({ available: false, reason: 'policy_off' });
  });

  it('refuses before review is complete and before any network call', async () => {
    await repository.startSession('Synthetic guide', '0.1.0');
    await repository.recordStep(/* same helper as above */);
    await repository.transition('stop');
    let executed = false;
    const gateway = new MockAtriumGateway();
    gateway.executeGuideWriter = async () => {
      executed = true;
      return { jobId: 'x', text: '{}' };
    };
    const service = new GuideWriterService(repository, editor, gateway, policy());
    expect(await service.write(crypto.randomUUID())).toMatchObject({
      errorCode: 'privacy_review_incomplete',
      ok: false,
    });
    expect(executed).toBe(false);
  });
});
```

Read `apps/browser-extension/test/editor-service.test.ts` for the real repository calls that add a recorded step (search for `recordStep` or `appendStep` and the `sequentialIds()` helper) and replace the two commented placeholders with that exact call sequence. The step must have `privacyReview` that `approve_clear_steps` can approve (no sensitive region).

Run: `bun run vitest run apps/browser-extension/test/guide-writer-service.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement the service**

`apps/browser-extension/src/guide-writer-service.ts`:

```ts
// ABOUTME: Runs the district Capture Guide Writer assistant over the reviewed session and
// ABOUTME: applies the validated suggestion through the editor, under managed policy.
import { GatewayError, type AtriumGateway } from '@atrium-capture/atrium-client';
import type { AtriumCaptureSession } from '@atrium-capture/contracts';
import { canFinalizeReview } from '@atrium-capture/editor-model';
import {
  GuideSuggestionError,
  applyGuideSuggestion,
  buildGuideWriterRequest,
  parseGuideSuggestionText,
  serializeGuideWriterRequest,
  validateGuideSuggestion,
} from '@atrium-capture/guide-writer';

import type { CaptureRepository } from './database.js';
import type { EditorService } from './editor-service.js';
import type { ManagedPolicySnapshot } from './managed-policy.js';

export type GuideWriterAvailability =
  | { available: true }
  | { available: false; reason: 'assistant_unconfigured' | 'gateway_unavailable' | 'policy_off' };

export type GuideWriterOutcome =
  | { ok: true; session: AtriumCaptureSession }
  | { errorCode: string; ok: false; retryable: boolean };

export class GuideWriterService {
  private forbiddenForSession = false;

  constructor(
    private readonly repository: CaptureRepository,
    private readonly editor: EditorService,
    private readonly gateway: AtriumGateway,
    private readonly policy: () => Promise<ManagedPolicySnapshot>,
  ) {}

  async availability(): Promise<GuideWriterAvailability> {
    const snapshot = await this.policy();
    if (!snapshot.valid || snapshot.policy.aiGuideWriting === 'off' || this.forbiddenForSession) {
      return { available: false, reason: 'policy_off' };
    }
    if (!snapshot.policy.atriumGuideWriterAssistantId) {
      return { available: false, reason: 'assistant_unconfigured' };
    }
    if (!(await this.gateway.capabilities()).guideWriter) {
      return { available: false, reason: 'gateway_unavailable' };
    }
    return { available: true };
  }

  async write(commandId: string): Promise<GuideWriterOutcome> {
    const availability = await this.availability();
    if (!availability.available) {
      return { errorCode: availability.reason, ok: false, retryable: false };
    }
    const snapshot = await this.policy();
    const assistantId = snapshot.policy.atriumGuideWriterAssistantId as number;
    const session = await this.repository.getActiveSession();
    if (!session) {
      return { errorCode: 'session_not_found', ok: false, retryable: false };
    }
    if (!canFinalizeReview(session)) {
      return { errorCode: 'privacy_review_incomplete', ok: false, retryable: false };
    }

    let steps: string;
    try {
      steps = serializeGuideWriterRequest(buildGuideWriterRequest(session));
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : 'guide_request_failed', false);
    }

    let text: string;
    try {
      ({ text } = await this.gateway.executeGuideWriter({ assistantId, steps }));
    } catch (error) {
      if (error instanceof GatewayError) {
        if (error.code === 'atrium_http_403' || error.code === 'insufficient_scope') {
          this.forbiddenForSession = true;
        }
        return this.failure(error.code, error.retryable);
      }
      return this.failure('guide_writer_failed', true);
    }

    let commands;
    try {
      const current = (await this.repository.getActiveSession()) ?? session;
      if (current.sessionId !== session.sessionId) {
        return this.failure('session_changed', false);
      }
      commands = applyGuideSuggestion(
        current,
        validateGuideSuggestion(parseGuideSuggestionText(text), current),
      );
    } catch (error) {
      const code = error instanceof GuideSuggestionError ? error.code : 'suggestion_invalid';
      return this.failure(code, true);
    }

    let updated = session;
    for (const [index, command] of commands.entries()) {
      updated = await this.editor.command(`${commandId}:${index}`, command);
    }
    return { ok: true, session: updated };
  }

  private async failure(errorCode: string, retryable: boolean): Promise<GuideWriterOutcome> {
    await this.repository
      .recordHealthEvent('guide_writer_failed', 'warning')
      .catch(() => undefined);
    return { errorCode, ok: false, retryable };
  }
}
```

Add `'guide_writer_failed'` to the `HealthEventCode` union in `database.ts`. Add `@atrium-capture/guide-writer: workspace:*` to `apps/browser-extension/package.json` dependencies and run `bun install`.

The `commandId:index` receipts keep each editor command idempotent across a service-worker restart in the same way `editor.command` already is. Confirm `repository.applyEditorCommand` accepts a non-UUID command id; if it validates UUIDs, derive per-command ids with `crypto.randomUUID()` and drop the suffix scheme.

Run: `bun run vitest run apps/browser-extension/test/guide-writer-service.test.ts`. Expected: PASS.

- [ ] **Step 4: Message, schema, background wiring**

In `message.schema.json` add a message entry mirroring `editor.finalize`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["kind", "payload"],
  "properties": {
    "kind": { "const": "editor.write-guide" },
    "payload": {
      "type": "object",
      "additionalProperties": false,
      "required": ["commandId"],
      "properties": { "commandId": { "type": "string", "format": "uuid" } }
    }
  }
}
```

Run `bun run messages:generate`. In `messages.ts` add:

```ts
export interface EditorWriteGuideMessage {
  kind: 'editor.write-guide';
  payload: { commandId: string };
}
```

and add it to the `IncomingMessage` union. Add to `messages.test.ts`:

```ts
it('accepts an editor.write-guide message', () => {
  expect(
    parseIncomingMessage({
      kind: 'editor.write-guide',
      payload: { commandId: '40000000-0000-4000-8000-000000000002' },
    }),
  ).toBeDefined();
});
```

In `background.ts`:

```ts
import { GuideWriterService } from '../src/guide-writer-service.js';
// after `const editor = new EditorService(...)`:
  const guideWriter = new GuideWriterService(repository, editor, atriumGateway, () =>
    managedPolicy.load(),
  );
// in the switch, after the 'editor.finalize' case:
      case 'editor.write-guide': {
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_write_guide');
        }
        const outcome = await guideWriter.write(message.payload.commandId);
        if (outcome.ok) {
          await publication.syncTitleForSession(outcome.session.sessionId);
        }
        return outcome;
      }
```

In `diagnostics-service.ts` add `aiGuideWriting: string;` and `guideWriterConfigured: boolean;` to `SupportDiagnostics.managedPolicy` and populate them from `managed.policy.aiGuideWriting` and `Boolean(managed.policy.atriumGuideWriterAssistantId)`. Update `apps/browser-extension/test/diagnostics-service.test.ts` expectations if they use `toEqual` on that object.

Run: `bun run vitest run apps/browser-extension && bun run --filter '@atrium-capture/browser-extension' typecheck`. Expected: PASS.

- [ ] **Step 5: Side panel button**

In `App.tsx` add state and a handler next to `finalize`:

```tsx
const [guideWriterError, setGuideWriterError] = useState<string>();
const [writingGuide, setWritingGuide] = useState(false);
const guideWriterVisible =
  diagnostics?.managedPolicy.aiGuideWriting !== 'off' &&
  diagnostics?.managedPolicy.guideWriterConfigured === true &&
  publication?.capabilities.guideWriter === true;

const writeGuide = async () => {
  setWritingGuide(true);
  setGuideWriterError(undefined);
  try {
    const outcome = (await browser.runtime.sendMessage({
      kind: 'editor.write-guide',
      payload: { commandId: crypto.randomUUID() },
    })) as { ok: true; session: AtriumCaptureSession } | { errorCode: string; ok: false };
    if (!outcome?.ok) {
      setGuideWriterError(guideWriterFailureMessage(outcome?.errorCode));
      return;
    }
    setSession(outcome.session);
  } catch {
    setGuideWriterError(guideWriterFailureMessage('guide_writer_failed'));
  } finally {
    setWritingGuide(false);
  }
};
```

Add a module-level helper at the bottom of `App.tsx`:

```tsx
function guideWriterFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'guide_request_too_large':
      return 'This guide has too many steps for the AI writer. Split it into smaller guides.';
    case 'policy_off':
      return 'AI guide writing is turned off by district policy.';
    case 'privacy_review_incomplete':
      return 'Approve every step before writing with AI.';
    default:
      return 'The AI writer could not finish. Your current text is unchanged. Try again.';
  }
}
```

Inside the review section, before the `finalize-row` div, add:

```tsx
{
  guideWriterVisible && (
    <div className="guide-writer-row">
      <button
        aria-busy={writingGuide}
        disabled={pending || writingGuide || issues.length > 0}
        onClick={() => void writeGuide()}
        type="button"
      >
        {writingGuide ? 'Writing step titles and instructions' : 'Write with AI'}
      </button>
      <small>
        {issues.length > 0
          ? 'Approve every step first. The AI writer sees step metadata, never screenshots.'
          : 'Fills the title and each step from step metadata. You can edit everything after.'}
      </small>
      {guideWriterError && (
        <p className="error" role="alert">
          {guideWriterError}{' '}
          <button onClick={() => void writeGuide()} type="button">
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
```

Find the `useState` for `publication` (the `PublicationSnapshot`) to confirm its variable name; the snippet assumes `publication`. Match the existing `.finalize-row` CSS by adding `.guide-writer-row` to the same rule in the side panel stylesheet (search `finalize-row` under `entrypoints/sidepanel/`).

Where the step list renders each step's text, show the step title when present: find the element that renders `step.instruction.editedText ?? step.instruction.generatedText` and prepend `{step.instruction.title && <strong>{step.instruction.title}. </strong>}`.

Run: `bun run --filter '@atrium-capture/browser-extension' typecheck && bun run lint`. Expected: clean.

- [ ] **Step 6: Playwright gating assertion**

In `recorder.pw.ts`, after the line `await expect(panel.getByRole('status')).toContainText('Privacy approved');` add:

```ts
// No assistant id is configured in this run, so the AI writer must stay hidden.
await expect(panel.getByRole('button', { name: 'Write with AI' })).toHaveCount(0);
```

The extension-loaded run cannot reach a mock assistant because the production gateway only talks to the fixed Atrium origin. The full write path is covered by the service test in Step 2 with `MockAtriumGateway`.

Run: `bun run test:extension`. Expected: PASS (requires the Playwright Chromium channel; `bunx playwright install chromium` if missing).

- [ ] **Step 7: Document the policy keys**

In `docs/browser-managed-policy.md` add two rows to the key table after `defaultCollectionId`:

```
| `aiGuideWriting`                | `on` or `off`                                    | `on`                   | Shows or hides "Write with AI" in review. Off never calls the assistant.                 |
| `atriumGuideWriterAssistantId`  | positive integer                                 | none                   | Atrium assistant id for the Capture Guide Writer. Unset hides the button.                |
```

Add a short section "AI guide writer" stating: metadata only, no screenshots, requires the `assistants:execute` scope, 128 KiB request limit, 120 s budget.

- [ ] **Step 8: Format, lint, full browser test, commit**

```bash
bun run format && bun run lint && bun run typecheck && bun run test && bun run messages:check
git add apps/browser-extension docs/browser-managed-policy.md bun.lock
git commit -m "feat(browser): Write with AI under managed policy"
```

---

### Task 6: Mac app gateway, editor, model, and button

**Files:**

- Modify: `apps/macos/Sources/AtriumCaptureCore/NativePublishing.swift` (`NativeAtriumCapabilities` gains `guideWriter`, protocol gains `executeGuideWriter`, `UnavailableNativeAtriumGateway` and `MockNativeAtriumGateway` implement it)
- Create: `apps/macos/Sources/AtriumCaptureCore/NativeGuideWriter.swift` (request builder, suggestion validation, apply)
- Create: `apps/macos/Tests/AtriumCaptureCoreTests/NativeGuideWriterTests.swift`
- Modify: `apps/macos/Sources/AtriumCaptureMacPlatform/ProductionNativeAtriumGateway.swift` (scope, settings, capabilities, method)
- Modify: `apps/macos/Tests/AtriumCaptureMacPlatformTests/ProductionNativeGatewayTests.swift`
- Modify: `apps/macos/Sources/AtriumCaptureMacApp/AtriumCaptureMacApp.swift` (`CaptureAppModel.writeGuideWithAI`, `guideWriterAvailable`, `guideWriterInProgress`)
- Modify: `apps/macos/Sources/AtriumCaptureMacApp/AtriumCaptureWorkspaceView.swift` (button in "Review & publish")
- Modify: `docs/macos-runbook.md`

**Interfaces:**

- Consumes: `NativeReviewEditor.suggestInstruction` (Task 2), `Instruction.title` (Task 1), `AtriumCaptureGuideSuggestion` (Task 1).
- Produces:
  - `NativeAtriumCapabilities.guideWriter: Bool` (new trailing init parameter with default `false` so existing call sites compile; production and mock pass `true`).
  - `NativeAtriumGateway.executeGuideWriter(assistantID: Int, steps: String) async throws -> NativeGuideWriterResult` where `public struct NativeGuideWriterResult: Equatable, Sendable { public let jobID: String; public let text: String }`.
  - `NativeAtriumProductionSettings.guideWriterAssistantID: Int?` and `aiGuideWritingEnabled: Bool`, read from env `ATRIUM_CAPTURE_GUIDE_WRITER_ASSISTANT_ID` / `ATRIUM_CAPTURE_AI_GUIDE_WRITING`, UserDefaults `AtriumGuideWriterAssistantId` / `AtriumAIGuideWriting`, Info.plist same keys. `AtriumAIGuideWriting` accepts `"on"`/`"off"`, default on.
  - `public enum NativeGuideWriter` with `static func buildRequest(for session: AtriumCaptureSession) throws -> String` (throws `NativeGuideWriterError.requestTooLarge`), `static func validate(text: String, session: AtriumCaptureSession) throws -> AtriumCaptureGuideSuggestion`, `static func apply(_ suggestion: AtriumCaptureGuideSuggestion, to session: AtriumCaptureSession, now: Date) throws -> AtriumCaptureSession`.
  - `public enum NativeGuideWriterError: Error, Equatable { case requestTooLarge, notJSON, invalid(String), sessionMismatch, unknownStep(String), missingStep(String) }`.
  - `NativeGatewayFailure` codes: `ATRIUM_JOB_FAILED`, `ATRIUM_JOB_CANCELLED`, `ATRIUM_JOB_TIMEOUT` (retryable), `ATRIUM_RESPONSE_INVALID` (not), existing HTTP mapping for 403.
  - `CaptureAppModel`: `var guideWriterAvailable: Bool`, `@Published private(set) var guideWriterInProgress: Bool`, `func writeGuideWithAI()`, status codes `WRITING_GUIDE_WITH_AI`, `GUIDE_WRITTEN_WITH_AI`, `GUIDE_WRITER_FAILED`, `GUIDE_WRITER_REQUEST_TOO_LARGE`, `GUIDE_WRITER_POLICY_OFF`.

- [ ] **Step 1: Core guide writer, tests first**

`apps/macos/Tests/AtriumCaptureCoreTests/NativeGuideWriterTests.swift`:

````swift
import AtriumCaptureContracts
@testable import AtriumCaptureCore
import XCTest

final class NativeGuideWriterTests: XCTestCase {
    func testRequestCarriesOnlyStepMetadata() throws {
        let session = makeSession()
        let text = try NativeGuideWriter.buildRequest(for: session)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        let steps = try XCTUnwrap(json["steps"] as? [[String: Any]])

        XCTAssertEqual(json["schemaVersion"] as? Int, 1)
        XCTAssertEqual(json["sessionId"] as? String, session.sessionID)
        XCTAssertEqual(steps.count, session.steps.count)
        XCTAssertEqual(steps[0]["appName"] as? String, "Synthetic App")
        XCTAssertEqual(steps[0]["windowTitle"] as? String, "Synthetic window")
        XCTAssertEqual(steps[0]["accessibleName"] as? String, "Synthetic button")
        XCTAssertEqual(steps[0]["instruction"] as? String, session.steps[0].instruction.generatedText)
        XCTAssertFalse(text.contains(session.steps[0].screenshotAssetID ?? "never"))
        XCTAssertFalse(text.contains("bounds"))
        XCTAssertFalse(text.contains("bundleId"))
    }

    func testRequestRejectsOversizeSessions() {
        var session = makeSession()
        let padded = String(repeating: "x", count: 1_900)
        session = session.with(steps: (0..<80).map { index in
            session.steps[0].with(
                instruction: session.steps[0].instruction.with(generatedText: padded),
                sequence: index,
                stepID: String(format: "10000000-0000-4000-8000-%012d", index)
            )
        })
        XCTAssertThrowsError(try NativeGuideWriter.buildRequest(for: session)) { error in
            XCTAssertEqual(error as? NativeGuideWriterError, .requestTooLarge)
        }
    }

    func testValidateRejectsUnknownMissingAndMismatchedSteps() throws {
        let session = makeSession()
        let good = suggestionJSON(for: session)
        XCTAssertNoThrow(try NativeGuideWriter.validate(text: good, session: session))
        XCTAssertNoThrow(try NativeGuideWriter.validate(text: "```json\n" + good + "\n```", session: session))

        let unknown = good.replacingOccurrences(of: session.steps[1].stepID, with: "10000000-0000-4000-8000-000000000099")
        XCTAssertThrowsError(try NativeGuideWriter.validate(text: unknown, session: session))

        let other = good.replacingOccurrences(of: session.sessionID, with: "00000000-0000-4000-8000-000000000009")
        XCTAssertThrowsError(try NativeGuideWriter.validate(text: other, session: session)) { error in
            XCTAssertEqual(error as? NativeGuideWriterError, .sessionMismatch)
        }
        XCTAssertThrowsError(try NativeGuideWriter.validate(text: "Here is the guide", session: session)) { error in
            XCTAssertEqual(error as? NativeGuideWriterError, .notJSON)
        }
    }

    func testApplyKeepsUserEditsAndSetsDistrictAI() throws {
        var session = makeSession()
        let firstID = session.steps[0].stepID
        session = try NativeReviewEditor.setInstruction(in: session, stepID: firstID, text: "My own words.")
        let suggestion = try NativeGuideWriter.validate(text: suggestionJSON(for: session), session: session)

        let applied = try NativeGuideWriter.apply(suggestion, to: session, now: Date(timeIntervalSince1970: 10))

        XCTAssertEqual(applied.title, "Synthetic written guide")
        XCTAssertEqual(applied.steps[0].instruction.editedText, "My own words.")
        XCTAssertEqual(applied.steps[0].instruction.userEdited, true)
        XCTAssertEqual(applied.steps[0].instruction.source, .districtAI)
        XCTAssertEqual(applied.steps[0].instruction.title, "Step 1")
        XCTAssertEqual(applied.steps[1].instruction.source, .districtAI)
        XCTAssertEqual(applied.steps[1].instruction.userEdited, false)
    }

    private func suggestionJSON(for session: AtriumCaptureSession) -> String {
        let steps = session.steps.enumerated().map { index, step in
            "{\"stepId\":\"\(step.stepID)\",\"title\":\"Step \(index + 1)\",\"instruction\":\"Do the synthetic thing \(index + 1).\"}"
        }.joined(separator: ",")
        return "{\"schemaVersion\":1,\"sessionId\":\"\(session.sessionID)\",\"title\":\"Synthetic written guide\",\"summary\":\"Synthetic summary.\",\"steps\":[\(steps)]}"
    }

    private func makeSession() -> AtriumCaptureSession {
        // Build a two-step .review session with macos targets (appName "Synthetic App",
        // windowTitle "Synthetic window", bundleId "test.synthetic", accessibleName "Synthetic button",
        // bounds set) and privacyReview .approved. Copy the construction used by
        // NativePrivacyAndPublishingTests.makeSession and add the target fields.
    }
}
````

Replace the `makeSession` comment with real construction code copied from `NativePrivacyAndPublishingTests.swift` (near line 584) before running.

Run: `bun run swift:test`. Expected: FAIL to compile (`NativeGuideWriter` missing).

- [ ] **Step 2: Implement `NativeGuideWriter.swift`**

````swift
// ABOUTME: Builds the metadata-only Capture Guide Writer request, validates the assistant's
// ABOUTME: JSON reply, and applies it to a reviewed session without touching user edits.
import AtriumCaptureContracts
import Foundation

public let nativeGuideWriterRequestLimitBytes = 131_072

public enum NativeGuideWriterError: Error, Equatable {
    case requestTooLarge
    case notJSON
    case invalid(String)
    case sessionMismatch
    case unknownStep(String)
    case missingStep(String)
}

public enum NativeGuideWriter {
    public static func buildRequest(for session: AtriumCaptureSession) throws -> String {
        let retainOrigin = session.policy.sourceURLRetention != .none
        let steps: [[String: Any]] = session.steps.sorted { $0.sequence < $1.sequence }.map { step in
            var record: [String: Any] = [
                "stepId": step.stepID,
                "sequence": step.sequence,
                "action": step.action.rawValue,
                "instruction": step.instruction.editedText ?? step.instruction.generatedText,
            ]
            put(&record, "role", step.target?.role)
            put(&record, "accessibleName", step.target?.accessibleName)
            put(&record, "pageTitle", step.target?.browser?.pageTitle)
            if retainOrigin, let origin = step.target?.browser?.origin {
                put(&record, "origin", NativePublishing.normalizedSourceOrigin(origin))
            }
            put(&record, "appName", step.target?.macos?.appName)
            put(&record, "windowTitle", step.target?.macos?.windowTitle)
            return record
        }
        let body: [String: Any] = [
            "schemaVersion": 1,
            "sessionId": session.sessionID,
            "title": session.title,
            "steps": steps,
        ]
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        guard data.count <= nativeGuideWriterRequestLimitBytes else {
            throw NativeGuideWriterError.requestTooLarge
        }
        return String(decoding: data, as: UTF8.self)
    }

    public static func validate(text: String, session: AtriumCaptureSession) throws -> AtriumCaptureGuideSuggestion {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("```") {
            trimmed = trimmed
                .replacingOccurrences(of: "^```(?:json)?\\s*", with: "", options: .regularExpression)
                .replacingOccurrences(of: "\\s*```$", with: "", options: .regularExpression)
        }
        guard let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw NativeGuideWriterError.notJSON }
        let allowed: Set<String> = ["schemaVersion", "sessionId", "title", "summary", "steps"]
        guard Set(object.keys).isSubset(of: allowed), allowed.isSubset(of: Set(object.keys)) else {
            throw NativeGuideWriterError.invalid("top-level properties")
        }
        let suggestion: AtriumCaptureGuideSuggestion
        do {
            suggestion = try AtriumContractCodec.makeDecoder().decode(AtriumCaptureGuideSuggestion.self, from: data)
        } catch {
            throw NativeGuideWriterError.invalid("decode")
        }
        guard suggestion.schemaVersion == 1 else { throw NativeGuideWriterError.invalid("schemaVersion") }
        guard suggestion.sessionID == session.sessionID else { throw NativeGuideWriterError.sessionMismatch }
        try check(suggestion.title, 1...200, "title")
        try check(suggestion.summary, 1...600, "summary")
        let sessionIDs = Set(session.steps.map(\.stepID))
        var seen = Set<String>()
        for step in suggestion.steps {
            guard sessionIDs.contains(step.stepID), !seen.contains(step.stepID) else {
                throw NativeGuideWriterError.unknownStep(step.stepID)
            }
            seen.insert(step.stepID)
            try check(step.title, 1...120, "step title")
            try check(step.instruction, 1...2_000, "instruction")
        }
        if let missing = sessionIDs.subtracting(seen).sorted().first {
            throw NativeGuideWriterError.missingStep(missing)
        }
        return suggestion
    }

    public static func apply(
        _ suggestion: AtriumCaptureGuideSuggestion,
        to session: AtriumCaptureSession,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        var updated = try NativeReviewEditor.setTitle(in: session, title: suggestion.title, now: now)
        for step in suggestion.steps {
            updated = try NativeReviewEditor.suggestInstruction(
                in: updated,
                stepID: step.stepID,
                text: step.instruction,
                title: step.title,
                now: now
            )
        }
        return updated
    }

    private static func put(_ record: inout [String: Any], _ key: String, _ value: String?) {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return }
        record[key] = value
    }

    private static func check(_ value: String, _ range: ClosedRange<Int>, _ label: String) throws {
        let count = value.trimmingCharacters(in: .whitespacesAndNewlines).count
        guard range.contains(count) else { throw NativeGuideWriterError.invalid(label) }
    }
}
````

`NativePublishing.normalizedSourceOrigin` is a placeholder name: search `NativePublishing.swift` for the function that filters browser origins for `sourceRef.sourceOrigins` (the Mac path strips them entirely, per the comment near `createPrivateDraft`). If no origin normalizer exists in Core, add a private `normalizedOrigin(_:)` in `NativeGuideWriter` that keeps only `http`/`https` origins without credentials and rejects loopback and RFC 1918 hosts, mirroring `normalizeCaptureSourceOriginForPublication` in `packages/atrium-client/src/index.ts:643`. Read `NativeReviewEditor.setTitle` to confirm its signature and that it does not reset `privacyReview`.

Run: `bun run swift:test`. Expected: PASS for `NativeGuideWriterTests`.

- [ ] **Step 3: Gateway protocol, capabilities, mock, unavailable**

In `NativePublishing.swift`:

- Add `public let guideWriter: Bool` to `NativeAtriumCapabilities` and a trailing `guideWriter: Bool = false` init parameter. Set `guideWriter: true` in `MockNativeAtriumGateway.capabilities`.
- Add after `NativeTitleResult`:

```swift
public struct NativeGuideWriterResult: Equatable, Sendable {
    public let jobID: String
    public let text: String

    public init(jobID: String, text: String) {
        self.jobID = jobID
        self.text = text
    }
}
```

- Add to the protocol: `func executeGuideWriter(assistantID: Int, steps: String) async throws -> NativeGuideWriterResult`.
- `UnavailableNativeAtriumGateway`: throw `NativeGatewayFailure(code: "ATRIUM_API_UNAVAILABLE", retryable: false)`.
- `MockNativeAtriumGateway`: parse `steps` with `JSONSerialization`, return a suggestion with title "Synthetic written guide", step titles "Step N", instructions suffixed " (AI)", summary "Synthetic summary written by the mock guide writer.", `jobID: "mock-job-\(UUID().uuidString)"`.

Search `apps/macos/Sources` and `Tests` for other `NativeAtriumGateway` conformers (grep `: NativeAtriumGateway`) and add the method to each test double, throwing `ATRIUM_API_UNAVAILABLE` where the double has no opinion.

- [ ] **Step 4: Production gateway, tests first**

Append to `ProductionNativeGatewayTests`:

```swift
    func testScopesIncludeAssistantExecute() {
        XCTAssertTrue(atriumOAuthScopes.contains("assistants:execute"))
    }

    func testGuideWriterExecutesThenPollsToCompletion() async throws {
        let transport = SyntheticAtriumTransport()
        let gateway = try ProductionNativeAtriumGateway(
            transport: transport,
            sleep: { _ in },
            accessToken: { "synthetic-token" }
        )
        let result = try await gateway.executeGuideWriter(assistantID: 42, steps: "{\"schemaVersion\":1}")
        XCTAssertEqual(result, NativeGuideWriterResult(jobID: "job-1", text: "{\"schemaVersion\":1}"))
        let requests = await transport.requests
        XCTAssertEqual(requests.first?.url?.path, "/api/v1/assistants/42/execute")
        XCTAssertEqual(requests.first?.value(forHTTPHeaderField: "Accept"), "application/json")
        let body = try XCTUnwrap(requests.first?.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual((json["inputs"] as? [String: Any])?["steps"] as? String, "{\"schemaVersion\":1}")
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/v1/jobs/job-1" }.count, 2)
    }

    func testGuideWriterMapsFailedJobAndBudget() async throws {
        let failing = SyntheticAtriumTransport(jobStatus: "failed")
        let gateway = try ProductionNativeAtriumGateway(transport: failing, sleep: { _ in }, accessToken: { "t" })
        await XCTAssertThrowsErrorAsync(try await gateway.executeGuideWriter(assistantID: 42, steps: "{}")) { error in
            XCTAssertEqual((error as? NativeGatewayFailure)?.code, "ATRIUM_JOB_FAILED")
            XCTAssertEqual((error as? NativeGatewayFailure)?.retryable, true)
        }

        var now: TimeInterval = 0
        let slow = SyntheticAtriumTransport(jobStatus: "processing")
        let budgeted = try ProductionNativeAtriumGateway(
            transport: slow,
            clock: { now },
            sleep: { seconds in now += seconds },
            accessToken: { "t" }
        )
        await XCTAssertThrowsErrorAsync(try await budgeted.executeGuideWriter(assistantID: 42, steps: "{}")) { error in
            XCTAssertEqual((error as? NativeGatewayFailure)?.code, "ATRIUM_JOB_TIMEOUT")
        }
        XCTAssertGreaterThanOrEqual(now, 120)
    }
```

Extend `SyntheticAtriumTransport` with an `init(jobStatus: String = "completed")`, a poll counter, and two routes:

```swift
        case ("POST", "/api/v1/assistants/42/execute"):
            return response(url: url, status: 202, body: [
                "data": ["jobId": "job-1", "status": "pending", "pollUrl": "/api/v1/jobs/job-1"],
            ])
        case ("GET", "/api/v1/jobs/job-1"):
            polls += 1
            if jobStatus == "completed" && polls < 2 {
                return response(url: url, status: 200, body: ["data": ["status": "processing", "pollingInterval": 1]])
            }
            var data: [String: Any] = ["status": jobStatus, "pollingInterval": 10_000]
            if jobStatus == "completed" { data["responseData"] = ["text": "{\"schemaVersion\":1}"] }
            if jobStatus == "failed" { data["errorMessage"] = "synthetic" }
            return response(url: url, status: 200, body: ["data": data])
```

If the test file has no `XCTAssertThrowsErrorAsync`, add a small file-private helper that awaits the expression inside `do/catch` and calls the handler.

Run: `bun run swift:test`. Expected: FAIL to compile (`sleep`, `clock`, `executeGuideWriter` missing).

Implement in `ProductionNativeAtriumGateway.swift`:

- Add `"assistants:execute"` to `atriumOAuthScopes`.
- Add constants: `let guideWriterBudget: TimeInterval = 120`, `let guideWriterPollMin: TimeInterval = 1`, `let guideWriterPollMax: TimeInterval = 10`.
- Add stored properties `private let clock: @Sendable () -> TimeInterval` and `private let sleep: @Sendable (TimeInterval) async throws -> Void`, with init parameters `clock: @escaping @Sendable () -> TimeInterval = { Date().timeIntervalSince1970 }` and `sleep: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }` placed before `accessToken` so the trailing closure stays `accessToken`.
- Set `guideWriter: true` in `capabilities`.
- Method:

```swift
    public func executeGuideWriter(assistantID: Int, steps: String) async throws -> NativeGuideWriterResult {
        guard assistantID > 0 else { throw NativeGatewayFailure(code: "ATRIUM_ASSISTANT_ID_INVALID", retryable: false) }
        let startedAt = clock()
        let accepted = try Self.record(try Self.record(try await apiJSON(
            path: "assistants/\(assistantID)/execute",
            method: "POST",
            body: ["inputs": ["steps": steps]]
        ))["data"])
        guard let jobID = Self.string(accepted["jobId"], maximum: 200) else { throw Self.invalidResponse() }
        var interval = Self.clampPollInterval(accepted["pollingInterval"])
        while true {
            if clock() - startedAt + interval > guideWriterBudget {
                throw NativeGatewayFailure(code: "ATRIUM_JOB_TIMEOUT", retryable: true)
            }
            try await sleep(interval)
            let job = try Self.record(try Self.record(try await apiJSON(path: "jobs/\(jobID)", method: "GET"))["data"])
            let status = Self.string(job["status"], maximum: 32) ?? ""
            switch status {
            case "completed":
                let responseData = try? Self.record(job["responseData"])
                let text = Self.string(responseData?["text"], maximum: 1_000_000)
                    ?? Self.string(responseData?["content"], maximum: 1_000_000)
                    ?? Self.string(job["partialContent"], maximum: 1_000_000)
                guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw Self.invalidResponse()
                }
                return NativeGuideWriterResult(jobID: jobID, text: text)
            case "failed", "cancelled":
                throw NativeGatewayFailure(code: "ATRIUM_JOB_\(status.uppercased())", retryable: true)
            case "pending", "processing", "streaming":
                interval = Self.clampPollInterval(job["pollingInterval"])
            default:
                throw Self.invalidResponse()
            }
        }
    }

    private static func clampPollInterval(_ value: Any?) -> TimeInterval {
        // Atrium reports pollingInterval in milliseconds.
        let milliseconds = (value as? NSNumber)?.doubleValue ?? (guideWriterPollMin * 1_000)
        return min(guideWriterPollMax, max(guideWriterPollMin, milliseconds / 1_000))
    }
```

Check that `apiJSON` sends a `GET` without a body correctly (it does: `body` is optional). `Self.record`, `Self.string`, and `Self.invalidResponse` already exist in the file; match their exact signatures.

Add the settings fields to `NativeAtriumProductionSettings`:

```swift
    public let guideWriterAssistantID: Int?
    public let aiGuideWritingEnabled: Bool
```

with init parameters defaulting to `nil` and `true`, and in `load(...)`:

```swift
        let assistantRaw = firstNonempty(
            environment["ATRIUM_CAPTURE_GUIDE_WRITER_ASSISTANT_ID"],
            defaults.string(forKey: "AtriumGuideWriterAssistantId"),
            (bundle.object(forInfoDictionaryKey: "AtriumGuideWriterAssistantId") as? NSNumber)?.stringValue,
            bundle.object(forInfoDictionaryKey: "AtriumGuideWriterAssistantId") as? String
        )
        let assistantID = assistantRaw.flatMap(Int.init).flatMap { $0 > 0 ? $0 : nil }
        if assistantRaw != nil, assistantID == nil { return nil }
        let aiRaw = firstNonempty(
            environment["ATRIUM_CAPTURE_AI_GUIDE_WRITING"],
            defaults.string(forKey: "AtriumAIGuideWriting"),
            bundle.object(forInfoDictionaryKey: "AtriumAIGuideWriting") as? String
        )?.lowercased()
        if let aiRaw, aiRaw != "on", aiRaw != "off" { return nil }
```

and pass `guideWriterAssistantID: assistantID, aiGuideWritingEnabled: aiRaw != "off"` to the initializer. Add a settings test next to `testProductionSettingsUsePublicManagedConfigurationAndDocumentedCallback` that sets both env vars and asserts the parsed values, and one that sets `ATRIUM_CAPTURE_AI_GUIDE_WRITING=maybe` and asserts `load` returns nil.

Run: `bun run swift:test`. Expected: PASS.

- [ ] **Step 5: App model and workspace button**

In `CaptureAppModel` (`AtriumCaptureMacApp.swift`):

```swift
    @Published private(set) var guideWriterInProgress = false
    private var guideWriterForbidden = false

    var guideWriterAvailable: Bool {
        guard !guideWriterForbidden else { return false }
        guard localMockEnabled || productionSettings?.aiGuideWritingEnabled == true else { return false }
        guard localMockEnabled || productionSettings?.guideWriterAssistantID != nil else { return false }
        return publisher.capabilities.guideWriter && (localMockEnabled || atriumAuthentication == .signedIn)
    }

    var canWriteGuideWithAI: Bool {
        guard guideWriterAvailable, !guideWriterInProgress, canEditGuideContent, let session else { return false }
        return (try? NativeReviewEditor.validatePrivacyAnnotations(in: session)) != nil
            && session.steps.allSatisfy { $0.privacyReview == .approved }
    }

    func writeGuideWithAI() {
        guard canWriteGuideWithAI, let current = recorder.snapshot() else { return }
        let assistantID = localMockEnabled ? 1 : (productionSettings?.guideWriterAssistantID ?? 0)
        guideWriterInProgress = true
        statusCode = "WRITING_GUIDE_WITH_AI"
        Task { @MainActor in
            defer { guideWriterInProgress = false }
            do {
                let steps = try NativeGuideWriter.buildRequest(for: current)
                let result = try await publisher.gateway.executeGuideWriter(assistantID: assistantID, steps: steps)
                guard recorder.snapshot()?.sessionID == current.sessionID, let latest = recorder.snapshot() else {
                    statusCode = "GUIDE_WRITER_FAILED"
                    return
                }
                let suggestion = try NativeGuideWriter.validate(text: result.text, session: latest)
                let updated = try NativeGuideWriter.apply(suggestion, to: latest)
                try recorder.replaceReviewedSession(updated)
                try repository.saveSession(updated)
                session = updated
                refreshGuides()
                statusCode = "GUIDE_WRITTEN_WITH_AI"
            } catch NativeGuideWriterError.requestTooLarge {
                statusCode = "GUIDE_WRITER_REQUEST_TOO_LARGE"
            } catch let failure as NativeGatewayFailure where failure.code == "ATRIUM_HTTP_403" || failure.code == "INSUFFICIENT_SCOPE" {
                guideWriterForbidden = true
                statusCode = "GUIDE_WRITER_POLICY_OFF"
            } catch {
                statusCode = "GUIDE_WRITER_FAILED"
            }
        }
    }
```

`publisher.gateway` must be reachable: check `DurableNativePublisher` for a `gateway` property and add `public let gateway: any NativeAtriumGateway` if it is private. Use the same review-completeness check the existing `flattenAndApprove()` uses (read it near line 990) instead of the two-line approximation above if it differs.

In `AtriumCaptureWorkspaceView.swift`, inside the "Review & publish" card after the "Prepare publishable images" button:

```swift
            if model.guideWriterAvailable {
                Button {
                    model.writeGuideWithAI()
                } label: {
                    Label(
                        model.guideWriterInProgress ? "Writing step titles and instructions" : "Write with AI",
                        systemImage: "sparkles"
                    )
                }
                .buttonStyle(AtriumSecondaryButtonStyle())
                .disabled(!model.canWriteGuideWithAI)
                Text("Fills the title and each step from step metadata. Screenshots never leave this Mac.")
                    .font(.system(size: 11))
                    .foregroundStyle(AtriumCaptureTheme.inkSoft)
            }
```

Where the step list renders instruction text, prefix with the title in bold when `step.instruction.title` is set.

Add a model test in `apps/macos/Tests/AtriumCaptureMacPlatformTests` only if `CaptureAppModel` is already tested there (grep `CaptureAppModel` in Tests). If it is not, the gating logic lives in `canWriteGuideWithAI`, which depends on `productionSettings`; cover the settings parsing in Step 4 and leave the SwiftUI gate to manual acceptance documented in Step 6.

Run: `bun run swift:test && bun run build:mac`. Expected: PASS and a successful app build.

- [ ] **Step 6: Runbook and commit**

In `docs/macos-runbook.md`, next to `AtriumDefaultCollectionId`, add:

```
- `AtriumGuideWriterAssistantId`: optional positive integer id of the district "Capture Guide Writer" assistant. Unset hides "Write with AI".
- `AtriumAIGuideWriting`: `on` (default) or `off`. Off hides the button and never calls the assistant.
```

Add a manual acceptance step: "With `ATRIUM_CAPTURE_LOCAL_MOCK=1`, record two steps, approve both, press Write with AI, confirm the title becomes 'Synthetic written guide' and each step gains a title."

```bash
bun run format && bun run lint
git add apps/macos docs/macos-runbook.md
git commit -m "feat(mac): Write with AI through the native Atrium gateway"
```

---

### Task 7: Assistant definition export, prompt, and integration docs

**Files:**

- Create: `docs/atrium/capture-guide-writer.assistant.json`
- Create: `docs/atrium/capture-guide-writer.md`
- Modify: `docs/atrium-integration.md` (new section "AI guide writer" after "## OAuth registration and configuration")
- Modify: `docs/security-and-privacy.md` (one paragraph on what the assistant receives)
- Modify: `scripts/validate-contracts.mjs` (validate the sample reply embedded in the prompt doc against the schema) or a new unit test under `packages/guide-writer/test/assistant-definition.test.ts`

**Interfaces:**

- Consumes: `contracts/guide-suggestion.schema.json` (Task 1), `validateGuideSuggestion` (Task 3).
- Produces: an import file in aistudio's `ExportFormat` version `1.0` (fields `version`, `exported_at`, `export_source`, `assistants[]` with `name`, `description`, `status`, `mode`, `prompts[]`, `input_fields[]`; see `lib/assistant-export-import.ts` in psd401/aistudio).

- [ ] **Step 1: Write the failing definition test**

`packages/guide-writer/test/assistant-definition.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const definitionPath = path.resolve(
  import.meta.dirname,
  '../../../docs/atrium/capture-guide-writer.assistant.json',
);

describe('Capture Guide Writer assistant definition', () => {
  it('is a version 1.0 Atrium export with one text input named steps', async () => {
    const definition = JSON.parse(await readFile(definitionPath, 'utf8')) as {
      assistants: Array<{
        input_fields: Array<{ field_type: string; name: string }>;
        name: string;
        prompts: Array<{ content: string; model_name: string }>;
      }>;
      version: string;
    };
    expect(definition.version).toBe('1.0');
    expect(definition.assistants).toHaveLength(1);
    const assistant = definition.assistants[0]!;
    expect(assistant.name).toBe('Capture Guide Writer');
    expect(assistant.input_fields).toEqual([
      expect.objectContaining({ field_type: 'long_text', name: 'steps' }),
    ]);
    expect(assistant.prompts).toHaveLength(1);
    const prompt = assistant.prompts[0]!.content;
    expect(prompt).toContain('${steps}');
    expect(prompt).toContain('"schemaVersion": 1');
    expect(prompt).toContain('Return only JSON');
    expect(prompt).not.toMatch(/screenshot|image/i);
  });
});
```

Run: `bun run vitest run packages/guide-writer/test/assistant-definition.test.ts`. Expected: FAIL, file missing.

Confirm the input placeholder syntax Atrium uses in prompt content (`${steps}` or `{{steps}}`) by reading `docs/API/v1/assistant-execution.md` and `lib/assistant-export-import.ts` in psd401/aistudio via `gh api`. Use the documented syntax in both the test and the file.

- [ ] **Step 2: Write the definition**

`docs/atrium/capture-guide-writer.assistant.json`:

```json
{
  "version": "1.0",
  "exported_at": "2026-10-14T00:00:00.000Z",
  "export_source": "psd401/atrium-capture docs/atrium",
  "assistants": [
    {
      "name": "Capture Guide Writer",
      "description": "Writes a guide title, summary, and per-step titles and instructions from Atrium Capture step metadata. Returns strict JSON. Never receives screenshots.",
      "status": "approved",
      "mode": "simple",
      "model_routing_mode": "fixed",
      "input_fields": [
        {
          "name": "steps",
          "label": "Capture steps (JSON)",
          "field_type": "long_text",
          "position": 0
        }
      ],
      "prompts": [
        {
          "name": "Write guide",
          "position": 0,
          "model_name": "claude-sonnet-5-5",
          "system_context": "You write short, plain instructions for school district staff. You receive metadata about recorded steps, never screenshots or typed values. Return only JSON.",
          "content": "<prompt text from Step 3, JSON-escaped>"
        }
      ]
    }
  ]
}
```

Read `lib/assistant-export-import.ts` and `lib/db/schema/tables/assistant-architects.ts` in psd401/aistudio to confirm the valid literal values for `status`, `mode`, `model_routing_mode`, and `field_type`, and the exact model name string the catalog uses for Sonnet 5.5. Replace any value the import validator would reject.

- [ ] **Step 3: Write the prompt and the human-readable doc**

`docs/atrium/capture-guide-writer.md` holds the prompt verbatim (the JSON file embeds the same text) and the import steps. Prompt:

```
You receive JSON describing steps a staff member recorded while doing a task in a browser or a Mac app. For each step you get the action type, the UI element role and accessible name, the page or window title, and the current draft instruction. You never receive screenshots, typed values, or URLs beyond an origin.

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

The doc also lists: how to import (Admin, Assistants, Import), how to find the assistant id after import (the numeric id in the assistant URL), where that id goes (Chrome managed policy `atriumGuideWriterAssistantId`, Mac `AtriumGuideWriterAssistantId`), and a sample reply that `validateGuideSuggestion` accepts (copy `packages/test-fixtures/fixtures/guide-suggestion-v1.json`).

Run the test from Step 1. Expected: PASS.

- [ ] **Step 4: Integration and privacy docs**

In `docs/atrium-integration.md` add after the OAuth section:

```markdown
## AI guide writer

The clients run one approved assistant, "Capture Guide Writer", through
`POST /api/v1/assistants/{id}/execute` with `Accept: application/json` and poll
`GET /api/v1/jobs/{jobId}` until `completed`, `failed`, or `cancelled`. The
request body is `{"inputs":{"steps":"<json string>"}}` and stays under 128 KiB.
Polling honours the server `pollingInterval` (milliseconds, clamped to 1 to 10 s)
inside a 120 s budget. The token needs `assistants:execute`.

The assistant receives step metadata only: action, element role and accessible
name, page title, policy-filtered origin, Mac app and window title, and the
current instruction text. Screenshots, typed values, selectors, bounds, paths,
and asset ids never leave the device for this feature. The assistant definition
is committed at `docs/atrium/capture-guide-writer.assistant.json`.
```

In `docs/security-and-privacy.md` add one paragraph under the data-flow section with the same metadata list and the policy switch names.

- [ ] **Step 5: Format and commit**

```bash
bun run format && bun run lint && bun run test
git add docs/atrium docs/atrium-integration.md docs/security-and-privacy.md packages/guide-writer/test/assistant-definition.test.ts
git commit -m "docs: Capture Guide Writer assistant definition and integration notes"
```

---

### Task 8: aistudio migration adding the execute scope to both first-party clients

This task runs in a clone of `psd401/aistudio`, not in this repository. Open a pull request there.

**Files (in psd401/aistudio):**

- Create: `infra/database/schema/188-atrium-capture-execute-scope.sql` (use the next free number after the last entry in `infra/database/migrations.json`)
- Modify: `infra/database/migrations.json` (append the filename)
- Create: `tests/unit/atrium-capture-execute-scope-migration.test.ts`

**Interfaces:**

- Consumes: `oauth_clients.allowed_scopes` (jsonb array), client ids `ae781263-20c0-4b0c-8a34-8be01ab72fb1` (browser) and `fbdaa815-1b0f-435b-805f-1732805720c1` (Mac), `is_first_party` from migration 134.
- Produces: both rows' `allowed_scopes` contain `assistants:execute`.

- [ ] **Step 1: Clone and read the conventions**

```bash
gh repo clone psd401/aistudio ~/code/aistudio-execute-scope -- --depth 50
cd ~/code/aistudio-execute-scope && git checkout -b feat/atrium-capture-execute-scope
cat CONTRIBUTING.md AGENTS.md | head -200
cat infra/database/schema/134-oauth-first-party-clients.sql infra/database/schema/138-atrium-capture-browser-registration.sql
tail -5 infra/database/migrations.json
```

Follow any rule in `CONTRIBUTING.md` about migration headers, the one-line PL/pgSQL rule, and test commands (`npm test` or the repository's documented runner).

- [ ] **Step 2: Write the failing migration test**

`tests/unit/atrium-capture-execute-scope-migration.test.ts`, mirroring `tests/unit/oauth-first-party-migration.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'infra/database/schema/188-atrium-capture-execute-scope.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');

describe('Atrium Capture execute scope migration', () => {
  it('adds assistants:execute to only the two exact first-party clients', () => {
    expect(migration).toContain('ae781263-20c0-4b0c-8a34-8be01ab72fb1');
    expect(migration).toContain('fbdaa815-1b0f-435b-805f-1732805720c1');
    expect(migration).toContain('is_first_party = true');
    expect(migration).toContain("token_endpoint_auth_method = 'none'");
    expect(migration).toContain('require_pkce = true');
    expect(migration).toContain('\'"assistants:execute"\'::jsonb');
    expect(migration).not.toContain('client_name =');
  });

  it('is idempotent and registered', () => {
    expect(migration).toContain("NOT allowed_scopes ? 'assistants:execute'");
    const registry = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'infra/database/migrations.json'), 'utf8'),
    ) as { migrations: string[] };
    expect(registry.migrations.at(-1)).toBe('188-atrium-capture-execute-scope.sql');
  });
});
```

Check the real top-level key name in `migrations.json` (the tail shows an array; confirm whether the key is `migrations`). Run the unit test the way the repository documents. Expected: FAIL, file missing.

- [ ] **Step 3: Write the migration**

```sql
-- =====================================================
-- Migration: 188-atrium-capture-execute-scope.sql
-- Description: Allow the two first-party Atrium Capture clients to request
--              assistants:execute for the district Capture Guide Writer.
-- Dependencies: 134-oauth-first-party-clients.sql,
--               138-atrium-capture-browser-registration.sql
--
-- Scope is appended only to the two exact client ids, only while each row
-- still matches its first-party public PKCE profile, and only if the scope is
-- not already present. Re-running is a no-op.
--
-- Rollback:
-- UPDATE oauth_clients
-- SET allowed_scopes = allowed_scopes - 'assistants:execute', updated_at = NOW()
-- WHERE client_id IN (
--   'ae781263-20c0-4b0c-8a34-8be01ab72fb1',
--   'fbdaa815-1b0f-435b-805f-1732805720c1'
-- );
-- =====================================================

UPDATE oauth_clients
SET
  allowed_scopes = allowed_scopes || '"assistants:execute"'::jsonb,
  updated_at = NOW()
WHERE client_id IN (
    'ae781263-20c0-4b0c-8a34-8be01ab72fb1',
    'fbdaa815-1b0f-435b-805f-1732805720c1'
  )
  AND is_first_party = true
  AND token_endpoint_auth_method = 'none'
  AND client_secret_hash IS NULL
  AND require_pkce = true
  AND is_active = true
  AND jsonb_typeof(allowed_scopes) = 'array'
  AND NOT allowed_scopes ? 'assistants:execute';
```

Append `"188-atrium-capture-execute-scope.sql"` to the registry array. Run the unit test. Expected: PASS. Run the repository's lint and the full unit suite as `CONTRIBUTING.md` directs.

- [ ] **Step 4: Open the pull request**

```bash
git add infra/database/schema/188-atrium-capture-execute-scope.sql infra/database/migrations.json tests/unit/atrium-capture-execute-scope-migration.test.ts
git commit -m "feat(oauth): allow assistants:execute for first-party Atrium Capture clients"
git push -u origin feat/atrium-capture-execute-scope
gh pr create --repo psd401/aistudio --title "Allow assistants:execute for Atrium Capture clients" --body-file /dev/stdin <<'BODY'
## Why

Atrium Capture gains an opt-in "Write with AI" step that runs one approved assistant, "Capture Guide Writer", over step metadata (no screenshots). Both first-party clients need `assistants:execute` in their scope allowlist. Companion PR: psd401/atrium-capture#<number>.

## What

- Migration 188 appends `assistants:execute` to the two exact first-party client rows, guarded by the same public-PKCE profile checks migration 134 and 138 use. Idempotent.
- Unit test pins the client ids, guards, and registry entry.

## Decision for review

`assistants:execute` permits executing any assistant the user can reach. The narrower per-assistant scope `assistant:{id}:execute` (checked first in `app/api/v1/assistants/[id]/execute/route.ts`) would limit the clients to one assistant, but the id is unknown until the assistant is imported, so it cannot be in this migration. If you prefer the narrow scope, import `docs/atrium/capture-guide-writer.assistant.json` from the capture repository first and I will change this migration to that id.

## Rollback

In the migration header.
BODY
```

Record the PR URL in the atrium-capture journal entry.

---

### Task 9: Full gate, backlog note, journal, and the atrium-capture pull request

**Files:**

- Modify: `docs/superpowers/backlog.md` (item 1 status)
- Modify: `/Users/HerberR_1/code/claudefeaturemaintenance/journal/atriumcapture/2026-10-14-d3271cc9.md` (append outcome)
- Modify: `docs/milestones.md` if it tracks shipped features (read it first)

- [ ] **Step 1: Run the full gate**

Run: `bun run check`
Expected: every stage green. If `swift:test` or `test:extension` fails for environment reasons (no Xcode, no Chromium), fix the environment or report the stage as unverified in the PR body; do not skip the stage silently.

- [ ] **Step 2: Whole-branch review**

Dispatch a reviewer (`claude-sonnet-5`, read-only) on `git diff main...feature/ai-guide-writer` with the Review Focus list from the top of this plan. Fix every confirmed finding in a follow-up commit per finding. Re-run `bun run check`.

- [ ] **Step 3: Backlog and journal**

In `docs/superpowers/backlog.md` change item 1's heading to "AI guide writer (PR open)" and add the aistudio PR link. Append to the journal: what shipped, the metadata-only decision, the `assistants:execute` versus per-assistant scope question, and what remains for Kris (import the assistant, set the id in policy, merge the aistudio migration).

```bash
git add docs/superpowers/backlog.md
git commit -m "docs: backlog status for AI guide writer"
```

- [ ] **Step 4: Open the pull request**

```bash
git push -u origin feature/ai-guide-writer
gh pr create --repo psd401/atrium-capture --title "AI guide writer: Write with AI from reviewed step metadata" --body-file /dev/stdin <<'BODY'
## What

After redaction review, "Write with AI" fills the guide title, summary, and each step's title and instruction from the district "Capture Guide Writer" assistant. Metadata only: action, role, accessible name, page or window title, policy-filtered origin, current text. No screenshots, typed values, selectors, bounds, paths, or asset ids leave the device. User-edited steps are never overwritten.

Spec: `docs/superpowers/specs/2026-10-14-ai-guide-writer-design.md`. Plan: `docs/superpowers/plans/2026-10-14-ai-guide-writer.md`.

## Changes

- Contracts: `guide-suggestion.schema.json` (v1) and optional `instruction.title` (additive, README note, fixtures in TS and Swift).
- Editor model: `suggest_instruction` command (TS and Swift). Markdown shows step titles.
- New `packages/guide-writer`: request builder, validator, apply.
- Gateways: `executeGuideWriter` with execute-and-poll (production, mock, HTTP mock, unavailable; Swift production and mock). Scope `assistants:execute`.
- Browser: managed policy `aiGuideWriting`, `atriumGuideWriterAssistantId`; `GuideWriterService`; `editor.write-guide` message; side panel button.
- Mac: settings `AtriumAIGuideWriting`, `AtriumGuideWriterAssistantId`; `NativeGuideWriter`; model and workspace button.
- Docs: assistant definition export, integration, policy, runbook, privacy.

## Needs from an Atrium admin

1. Merge psd401/aistudio#<number> (adds the scope to both client allowlists).
2. Import `docs/atrium/capture-guide-writer.assistant.json`, note the assistant id.
3. Set the id in Chrome managed policy and the Mac preference. Until then the button stays hidden.

## Verification

`bun run check` output summary and the manual Mac mock acceptance from `docs/macos-runbook.md`.

## Backlog

Vision input (screenshots to the model) is blocked on an aistudio change; see `docs/superpowers/backlog.md`.
BODY
```

Paste the real `bun run check` summary and the two PR numbers into the body before submitting.
