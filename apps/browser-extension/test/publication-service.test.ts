import { Action, MIMEType, Phase } from '@atrium-capture/contracts';
import { MockAtriumGateway } from '@atrium-capture/atrium-client/mock';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

import { CaptureRepository } from '../src/database.js';
import { BrowserPublicationService } from '../src/publication-service.js';

const databaseName = `atrium-capture-publication-${crypto.randomUUID()}`;
const repositories: CaptureRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.map((repository) => repository.close()));
  repositories.length = 0;
  const cleanup = new CaptureRepository(databaseName);
  await cleanup.deleteForTests();
});

describe('browser durable publication service', () => {
  it('resumes from IndexedDB after a worker restart without uploading the raw source', async () => {
    const beforeRestart = makeRepository();
    const { derivativeAssetId, rawAssetId } = await preparePublishableSession(beforeRestart);
    const gateway = new MockAtriumGateway({ failAfterCommit: ['create_object'] });
    const firstService = new BrowserPublicationService(beforeRestart, gateway);

    const interrupted = await firstService.enqueue();
    expect(interrupted.lastError?.retryable).toBe(true);
    expect(gateway.snapshot().objects).toHaveLength(1);
    await beforeRestart.close();

    const afterRestart = makeRepository();
    const recoveredService = new BrowserPublicationService(afterRestart, gateway);
    await recoveredService.resumePending();
    const recovered = await recoveredService.snapshot();

    expect(recovered.job?.phase).toBe(Phase.ReadyAsDraft);
    expect(recovered.job?.readerUrl).toMatch(/^https:\/\/atrium\.example\.test\/reader\//);
    expect((await afterRestart.getActiveSession())?.state).toBe('submitted');
    expect(gateway.snapshot().objects).toHaveLength(1);
    expect(gateway.snapshot().assets).toHaveLength(1);
    expect(gateway.snapshot().assets[0]?.localAssetId).toBe(derivativeAssetId);
    expect(gateway.snapshot().assets[0]?.localAssetId).not.toBe(rawAssetId);
    expect(gateway.snapshot().versions).toHaveLength(1);
  });
});

function makeRepository(): CaptureRepository {
  const ids = [
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
  ];
  let index = 0;
  const repository = new CaptureRepository(databaseName, () => ids[index++] ?? crypto.randomUUID());
  repositories.push(repository);
  return repository;
}

async function preparePublishableSession(repository: CaptureRepository): Promise<{
  derivativeAssetId: string;
  rawAssetId: string;
}> {
  const rawBytes = new Blob(['SYNTHETIC-RAW-NEVER-UPLOAD'], { type: 'image/png' });
  const derivativeBytes = new Blob(['SYNTHETIC-FLATTENED-PUBLISHABLE'], { type: 'image/png' });
  await repository.startSession('Synthetic browser publish', '0.1.0', new Date(0));
  const receipt = await repository.applyEvent(
    {
      action: Action.Click,
      eventId: '40000000-0000-4000-8000-000000000001',
      occurredAt: new Date(1),
      target: { accessibleName: 'Synthetic control', role: 'button' },
    },
    {
      blob: rawBytes,
      mimeType: MIMEType.ImagePNG,
      pixelHeight: 1,
      pixelWidth: 1,
      sha256: await sha256Hex(rawBytes),
    },
  );
  await repository.transition('stop', new Date(2));
  await repository.applyEditorCommand(
    '50000000-0000-4000-8000-000000000001',
    { kind: 'approve_step', stepId: receipt.stepId! },
    new Date(3),
  );
  const review = await repository.getActiveSession();
  const rawAssetId = review?.steps[0]?.screenshotAssetId;
  if (!review || !rawAssetId) {
    throw new Error('synthetic_review_setup_failed');
  }
  const derivativeAssetId = '60000000-0000-4000-8000-000000000001';
  await repository.finalizeReview(
    '50000000-0000-4000-8000-000000000002',
    review.revision,
    [
      {
        assetId: derivativeAssetId,
        localKey: `sessions/${review.sessionId}/publishable/${derivativeAssetId}.png`,
        prepared: {
          blob: derivativeBytes,
          mimeType: MIMEType.ImagePNG,
          pixelHeight: 1,
          pixelWidth: 1,
          sha256: await sha256Hex(derivativeBytes),
        },
        sourceAssetId: rawAssetId,
        stepId: receipt.stepId!,
      },
    ],
    'delete_after_flatten',
    new Date(4),
  );
  return { derivativeAssetId, rawAssetId };
}

async function sha256Hex(bytes: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
