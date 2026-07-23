import { Action } from '@atrium-capture/contracts';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CaptureRepository } from '../src/database.js';
import type { CaptureEventMessage } from '../src/messages.js';
import { RecorderService } from '../src/recorder-service.js';
import type { SerializedScreenshotCapture } from '../src/screenshot.js';

const databaseName = `atrium-recorder-service-${crypto.randomUUID()}`;
const repository = new CaptureRepository(databaseName);
const screenshots = {
  capture: vi.fn().mockRejectedValue(new Error('synthetic capture unavailable')),
} as unknown as SerializedScreenshotCapture;
const service = new RecorderService(repository, screenshots, async () => undefined);

afterEach(async () => {
  await repository.deleteForTests();
  vi.clearAllMocks();
});

describe('recorder service trust boundary', () => {
  it('uses the trusted sender URL and origin-only policy', async () => {
    await service.command('start', 'Synthetic service test');
    const message: CaptureEventMessage = {
      kind: 'capture.event',
      payload: {
        action: Action.Click,
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        target: {
          accessibleName: 'Synthetic control',
          browser: {
            devicePixelRatio: 2,
            origin: 'https://forged.invalid',
            path: '/forged',
            viewportCss: { height: 720, width: 1280 },
          },
        },
      },
    };

    await service.handleEvent(message, {
      frameId: 0,
      tab: { active: true, id: 1, url: 'https://fixture.test/real?private=yes', windowId: 1 },
    });
    const session = await service.getSnapshot();

    expect(session?.steps[0]?.target?.browser?.origin).toBe('https://fixture.test');
    expect(session?.steps[0]?.target?.browser?.path).toBeUndefined();
  });

  it('rejects events without a trusted top-frame tab sender', async () => {
    const message: CaptureEventMessage = {
      kind: 'capture.event',
      payload: {
        action: Action.Click,
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
      },
    };

    await expect(service.handleEvent(message, { frameId: 1 })).rejects.toThrow(
      'untrusted_content_sender',
    );
  });
});
