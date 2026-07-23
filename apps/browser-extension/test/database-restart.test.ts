import { Action } from '@atrium-capture/contracts';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

import { CaptureRepository } from '../src/database.js';

const databaseName = `atrium-capture-test-${crypto.randomUUID()}`;
const repositories: CaptureRepository[] = [];

function repository(): CaptureRepository {
  const next = new CaptureRepository(databaseName);
  repositories.push(next);
  return next;
}

afterEach(async () => {
  await Promise.all(repositories.map((item) => item.close()));
  repositories.length = 0;
  const cleanup = new CaptureRepository(databaseName);
  await cleanup.deleteForTests();
});

describe('IndexedDB restart recovery', () => {
  it('persists an acknowledged event and deduplicates its retry after restart', async () => {
    const beforeRestart = repository();
    await beforeRestart.startSession('Synthetic restart test', '0.1.0', new Date(0));
    const observedEvent = {
      action: Action.Click,
      eventId: '10000000-0000-4000-8000-000000000099',
      occurredAt: new Date(1_000),
      target: {
        accessibleName: 'Synthetic control',
        browser: {
          devicePixelRatio: 2,
          origin: 'https://fixture.test',
          viewportCss: { height: 720, width: 1280 },
        },
        role: 'button',
      },
    };

    const acknowledged = await beforeRestart.applyEvent(observedEvent);
    await beforeRestart.close();

    const afterRestart = repository();
    const replayAcknowledgement = await afterRestart.applyEvent(observedEvent);
    const recoveredSession = await afterRestart.getActiveSession();

    expect(replayAcknowledgement).toEqual(acknowledged);
    expect(recoveredSession?.steps).toHaveLength(1);
    expect(recoveredSession?.steps[0]?.stepId).toBe(acknowledged.stepId);
    expect(recoveredSession?.revision).toBe(1);
  });

  it('persists pause/resume state across repository instances', async () => {
    const first = repository();
    await first.startSession('Synthetic state test', '0.1.0');
    await first.transition('pause');
    await first.close();

    const second = repository();
    expect((await second.getActiveSession())?.state).toBe('paused');
    expect((await second.transition('resume'))?.state).toBe('recording');
  });
});
