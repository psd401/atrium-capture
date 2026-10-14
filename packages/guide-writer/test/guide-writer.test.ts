// ABOUTME: Tests for the metadata-only guide writer request builder, suggestion validation, and
// ABOUTME: apply-to-editor-commands conversion.
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
  type AtriumCaptureGuideSuggestion,
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

function fixtureSuggestion(): AtriumCaptureGuideSuggestion {
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
            backingScaleFactor: 2,
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
