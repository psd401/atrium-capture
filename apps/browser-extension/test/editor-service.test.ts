import {
  Action,
  AssetState,
  AtriumCaptureSessionState,
  Kind,
  MIMEType,
} from '@atrium-capture/contracts';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CaptureRepository, type PreparedScreenshot } from '../src/database.js';
import { EditorService } from '../src/editor-service.js';

const databaseName = `atrium-editor-service-${crypto.randomUUID()}`;
const repository = new CaptureRepository(databaseName, sequentialIds());
const sourceScreenshot: PreparedScreenshot = {
  blob: new Blob(['synthetic raw bytes'], { type: MIMEType.ImagePNG }),
  mimeType: MIMEType.ImagePNG,
  pixelHeight: 100,
  pixelWidth: 200,
  sha256: 'a'.repeat(64),
};
const flattenedScreenshot: PreparedScreenshot = {
  blob: new Blob(['synthetic flattened bytes'], { type: MIMEType.ImagePNG }),
  mimeType: MIMEType.ImagePNG,
  pixelHeight: 40,
  pixelWidth: 80,
  sha256: 'b'.repeat(64),
};

afterEach(async () => {
  await repository.deleteForTests();
});

describe('durable review and asset lifecycle', () => {
  it('deduplicates editor commands across restart', async () => {
    await repository.startSession('Synthetic editor restart', '0.1.0');
    await repository.transition('stop');
    const commandId = '40000000-0000-4000-8000-000000000001';
    const command = { kind: 'insert_step' as const, text: 'Complete the synthetic check.' };

    await repository.applyEditorCommand(commandId, command);
    await repository.close();
    await repository.applyEditorCommand(commandId, command);

    expect((await repository.getActiveSession())?.steps).toHaveLength(1);
  });

  it('atomically stores publishable derivatives and deletes raw bytes after privacy approval', async () => {
    await repository.startSession('Synthetic image lifecycle', '0.1.0');
    await repository.applyEvent(
      {
        action: Action.Input,
        eventId: '50000000-0000-4000-8000-000000000001',
        occurredAt: new Date(1),
        target: {
          bounds: { height: 20, width: 40, x: 10, y: 10 },
          browser: {
            devicePixelRatio: 1,
            origin: 'https://fixture.test',
            viewportCss: { height: 100, width: 200 },
          },
          role: 'textbox',
        },
      },
      sourceScreenshot,
    );
    await repository.transition('stop');
    const beforeReview = await repository.getActiveSession();
    const step = beforeReview?.steps[0];
    const rawAssetId = step?.screenshotAssetId;
    if (!step || !rawAssetId) {
      throw new Error('synthetic_step_missing');
    }
    const flatten = vi.fn().mockResolvedValue(flattenedScreenshot);
    const editor = new EditorService(
      repository,
      async () => undefined,
      flatten,
      () => '60000000-0000-4000-8000-000000000001',
    );
    await editor.command('70000000-0000-4000-8000-000000000001', {
      annotation: {
        color: '#111827',
        geometry: { height: 20, width: 40, x: 10, y: 10 },
        id: '80000000-0000-4000-8000-000000000001',
        kind: Kind.Redaction,
      },
      kind: 'add_annotation',
      stepId: step.stepId,
    });
    await editor.command('70000000-0000-4000-8000-000000000002', {
      kind: 'approve_step',
      stepId: step.stepId,
    });
    const finalized = await editor.finalize(
      '70000000-0000-4000-8000-000000000003',
      'delete_after_flatten',
    );

    expect(finalized.state).toBe(AtriumCaptureSessionState.Publishable);
    expect(finalized.assets.find((asset) => asset.assetId === rawAssetId)?.state).toBe(
      AssetState.Deleted,
    );
    expect(await repository.getStoredAsset(rawAssetId)).toBeUndefined();
    const publishable = finalized.assets.find(
      (asset) => asset.state === AssetState.PublishableLocal,
    );
    expect(publishable?.derivedFromAssetId).toBe(rawAssetId);
    expect(publishable && (await repository.getStoredAsset(publishable.assetId))?.blob).toEqual(
      flattenedScreenshot.blob,
    );
    expect(finalized.steps[0]?.screenshotAssetId).toBe(publishable?.assetId);
    expect(flatten).toHaveBeenCalledOnce();
  });

  it('may retain raw bytes until submit without making them publishable', async () => {
    await repository.startSession('Synthetic retained raw', '0.1.0');
    const receipt = await repository.applyEvent(
      {
        action: Action.Click,
        eventId: '50000000-0000-4000-8000-000000000010',
        occurredAt: new Date(1),
      },
      sourceScreenshot,
    );
    await repository.transition('stop');
    await repository.applyEditorCommand('70000000-0000-4000-8000-000000000010', {
      kind: 'approve_step',
      stepId: receipt.stepId!,
    });
    const review = await repository.getActiveSession();
    const rawAssetId = review?.steps[0]?.screenshotAssetId;
    if (!review || !rawAssetId) {
      throw new Error('synthetic_retention_setup_failed');
    }

    const finalized = await repository.finalizeReview(
      '70000000-0000-4000-8000-000000000011',
      review.revision,
      [
        {
          assetId: '60000000-0000-4000-8000-000000000010',
          localKey: 'synthetic/publishable.png',
          prepared: flattenedScreenshot,
          sourceAssetId: rawAssetId,
          stepId: receipt.stepId!,
        },
      ],
      'delete_after_submit',
    );

    expect(finalized.assets.find((asset) => asset.assetId === rawAssetId)?.state).toBe(
      AssetState.RawLocal,
    );
    expect((await repository.getStoredAsset(rawAssetId))?.blob).toEqual(sourceScreenshot.blob);
    expect(
      finalized.assets.filter((asset) => asset.state === AssetState.PublishableLocal),
    ).toHaveLength(1);
  });
});

function sequentialIds(): () => string {
  let counter = 0;
  return () => `90000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}
