import { Action } from '@atrium-capture/contracts';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CaptureRepository } from '../src/database.js';
import { parseManagedPolicy } from '../src/managed-policy.js';
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

  it('enforces managed site access and a stricter no-URL retention policy', async () => {
    const managed = parseManagedPolicy({
      allowedOrigins: ['https://fixture.test'],
      maxSessionSteps: 100,
      maxStorageBytes: 16_777_216,
      rawImageRetention: 'delete_after_flatten',
      schemaVersion: 1,
      sourceUrlRetention: 'none',
    });
    const managedService = new RecorderService(
      repository,
      screenshots,
      async () => undefined,
      '0.1.0',
      async () => managed,
    );
    await managedService.command('start', 'Synthetic managed policy');

    expect((await managedService.contentState('https://other.test/page')).active).toBe(false);
    expect((await managedService.contentState('https://fixture.test/private')).active).toBe(true);

    await managedService.handleEvent(clickMessage(), {
      frameId: 0,
      tab: { active: true, id: 1, url: 'https://fixture.test/private?secret=yes', windowId: 1 },
    });
    const session = await managedService.getSnapshot();
    expect(session?.policy.sourceUrlRetention).toBe('none');
    expect(session?.steps[0]?.target?.browser).toBeUndefined();
  });

  it('pauses before a screenshot would exceed the managed storage budget', async () => {
    const managed = parseManagedPolicy({
      maxSessionSteps: 100,
      maxStorageBytes: 16_777_216,
      rawImageRetention: 'delete_after_flatten',
      schemaVersion: 1,
      sourceUrlRetention: 'origin',
    });
    const oversizedScreenshots = {
      capture: vi.fn().mockResolvedValue({
        blob: new Blob([new Uint8Array(16_777_217)]),
        mimeType: 'image/png',
        pixelHeight: 1,
        pixelWidth: 1,
        sha256: 'a'.repeat(64),
      }),
    } as unknown as SerializedScreenshotCapture;
    const managedService = new RecorderService(
      repository,
      oversizedScreenshots,
      async () => undefined,
      '0.1.0',
      async () => managed,
    );
    await managedService.command('start', 'Synthetic quota');

    const receipt = await managedService.handleEvent(clickMessage(), {
      frameId: 0,
      tab: { active: true, id: 1, url: 'https://fixture.test', windowId: 1 },
    });

    expect(receipt.disposition).toBe('ignored');
    expect((await managedService.getSnapshot())?.state).toBe('paused');
    expect((await repository.storageSummary()).assetBytes).toBe(0);
  });

  it('refuses to start when configured managed data is invalid', async () => {
    const managedService = new RecorderService(
      repository,
      screenshots,
      async () => undefined,
      '0.1.0',
      async () => parseManagedPolicy({ schemaVersion: 9 }),
    );

    await expect(managedService.command('start', 'Synthetic invalid policy')).rejects.toThrow(
      'managed_policy_invalid',
    );
  });
});

function clickMessage(): CaptureEventMessage {
  return {
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
}
