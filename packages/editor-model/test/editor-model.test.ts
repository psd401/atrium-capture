import {
  Action,
  AssetState,
  AtriumCaptureSessionState,
  Kind,
  MIMEType,
  PrivacyReview,
  ReviewStatus,
  SchemaVersion,
  Source,
  SourceURLRetention,
  Surface,
  type AtriumCaptureSession,
} from '@atrium-capture/contracts';
import { describe, expect, it } from 'vitest';

import {
  applyEditorCommand,
  canFinalizeReview,
  reviewIssues,
  sensitiveRegionFlags,
} from '../src/index.js';

const firstStepId = '10000000-0000-4000-8000-000000000001';
const secondStepId = '10000000-0000-4000-8000-000000000002';
const assetId = '20000000-0000-4000-8000-000000000001';

describe('editor commands', () => {
  it('reorders, inserts, merges, edits, crops, and deletes with contiguous sequence numbers', () => {
    let session = fixtureSession();
    session = applyEditorCommand(session, { kind: 'move_step', stepId: secondStepId, toIndex: 0 });
    session = applyEditorCommand(
      session,
      { afterStepId: secondStepId, kind: 'insert_step', text: 'Confirm the synthetic result.' },
      { idFactory: () => '10000000-0000-4000-8000-000000000003', now: new Date(3) },
    );
    session = applyEditorCommand(session, {
      kind: 'update_instruction',
      stepId: secondStepId,
      text: 'Choose the synthetic destination.',
    });
    session = applyEditorCommand(session, {
      crop: { height: 60, width: 100, x: 10, y: 10 },
      kind: 'set_crop',
      stepId: secondStepId,
    });
    session = applyEditorCommand(session, {
      kind: 'merge_step',
      stepId: secondStepId,
      withStepId: '10000000-0000-4000-8000-000000000003',
    });
    session = applyEditorCommand(session, { kind: 'delete_step', stepId: firstStepId });

    expect(session.steps).toHaveLength(1);
    expect(session.steps[0]?.sequence).toBe(0);
    expect(session.steps[0]?.crop).toEqual({ height: 60, width: 100, x: 10, y: 10 });
    expect(session.steps[0]?.instruction.editedText).toContain('Confirm the synthetic result.');
    expect(session.policy.reviewStatus).toBe(ReviewStatus.InReview);
  });

  it('requires an opaque redaction covering an automated input region before approval', () => {
    let session = fixtureSession();
    const flag = sensitiveRegionFlags(session)[0];
    expect(flag?.geometry).toEqual({ height: 40, width: 200, x: 20, y: 40 });
    expect(() =>
      applyEditorCommand(session, { kind: 'approve_step', stepId: firstStepId }),
    ).toThrow('sensitive_region_requires_redaction');

    session = applyEditorCommand(session, {
      annotation: {
        geometry: { height: 40, width: 200, x: 20, y: 40 },
        id: '30000000-0000-4000-8000-000000000001',
        kind: Kind.Mosaic,
      },
      kind: 'add_annotation',
      stepId: firstStepId,
    });
    expect(() =>
      applyEditorCommand(session, { kind: 'approve_step', stepId: firstStepId }),
    ).toThrow('sensitive_region_requires_redaction');

    session = applyEditorCommand(session, {
      annotation: {
        color: '#111827',
        geometry: { height: 40, width: 200, x: 20, y: 40 },
        id: '30000000-0000-4000-8000-000000000002',
        kind: Kind.Redaction,
      },
      kind: 'add_annotation',
      stepId: firstStepId,
    });
    session = applyEditorCommand(session, { kind: 'approve_clear_steps' });

    expect(reviewIssues(session)).toEqual([]);
    expect(canFinalizeReview(session)).toBe(true);
  });

  it('bulk approval leaves an uncovered sensitive step blocked in one revision', () => {
    const session = applyEditorCommand(fixtureSession(), { kind: 'approve_clear_steps' });

    expect(session.revision).toBe(2);
    expect(session.steps[0]?.privacyReview).toBe(PrivacyReview.Flagged);
    expect(session.steps[1]?.privacyReview).toBe(PrivacyReview.Approved);
    expect(reviewIssues(session)).toEqual([
      { code: 'sensitive_region_unredacted', stepId: firstStepId },
      { code: 'step_not_approved', stepId: firstStepId },
    ]);
  });
});

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
    sessionId: '00000000-0000-4000-8000-000000000001',
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
        privacyReview: PrivacyReview.Flagged,
        screenshotAssetId: assetId,
        sequence: 0,
        stepId: firstStepId,
        target: {
          bounds: { height: 20, width: 100, x: 10, y: 20 },
          browser: {
            devicePixelRatio: 2,
            origin: 'https://fixture.test',
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
        privacyReview: PrivacyReview.NotReviewed,
        sequence: 1,
        stepId: secondStepId,
      },
    ],
    title: 'Synthetic editor fixture',
    updatedAt: new Date(2),
  };
}
