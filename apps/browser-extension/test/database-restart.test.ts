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
  it('upgrades a version-one recorder database without losing its active session', async () => {
    const legacyName = `${databaseName}-legacy`;
    const legacy = await openLegacyDatabase(legacyName);
    legacy.close();
    const upgraded = new CaptureRepository(legacyName);
    repositories.push(upgraded);

    const session = await upgraded.startSession('Synthetic migrated session', '0.1.0');
    await upgraded.transition('stop');
    const reviewed = await upgraded.applyEditorCommand('30000000-0000-4000-8000-000000000001', {
      kind: 'begin_review',
    });

    expect(session.title).toBe('Synthetic migrated session');
    expect(reviewed.state).toBe('review');
    await upgraded.deleteForTests();
  });

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

  it('starts a new guide without deleting the prior guide and can reopen either after restart', async () => {
    const first = repository();
    const original = await first.startSession('Synthetic original guide', '0.1.0');
    await first.applyEvent({
      action: Action.Click,
      eventId: '10000000-0000-4000-8000-000000000101',
      occurredAt: new Date(1),
    });
    await first.transition('stop');
    const created = await first.startNewSession('Synthetic second guide', '0.1.0', new Date(2));
    await expect(first.activateSession(original.sessionId)).rejects.toThrow(
      'active_recording_must_stop',
    );
    await expect(
      first.startNewSession('Synthetic forbidden third guide', '0.1.0', new Date(3)),
    ).rejects.toThrow('active_recording_must_stop');
    await first.transition('stop');
    await first.close();

    const restarted = repository();
    expect((await restarted.getActiveSession())?.sessionId).toBe(created.sessionId);
    expect(await restarted.listSessions()).toHaveLength(2);

    const reopened = await restarted.activateSession(original.sessionId);
    expect(reopened.title).toBe('Synthetic original guide');
    expect(reopened.steps).toHaveLength(1);
    expect((await restarted.getActiveSession())?.sessionId).toBe(original.sessionId);
  });

  it('deletes all local capture stores for user-initiated rollback', async () => {
    const current = repository();
    await current.startSession('Synthetic deletion', '0.1.0');
    await current.applyEvent({
      action: Action.Click,
      eventId: '10000000-0000-4000-8000-000000000100',
      occurredAt: new Date(1),
    });

    await current.deleteAllLocalData();

    expect(await current.getActiveSession()).toBeUndefined();
    expect(await current.storageSummary()).toEqual({
      assetBytes: 0,
      assetCount: 0,
      publishJobCount: 0,
      sessionCount: 0,
    });
  });

  it('bounds the telemetry-free operational health ring to the latest 100 codes', async () => {
    const current = repository();
    for (let index = 0; index < 120; index += 1) {
      await current.recordHealthEvent(
        'worker_started',
        'info',
        new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      );
    }

    const events = await current.listHealthEvents(100);
    expect(events).toHaveLength(100);
    expect(events[0]?.occurredAt).toBe('2026-01-01T00:01:59.000Z');
    expect(events.at(-1)?.occurredAt).toBe('2026-01-01T00:00:20.000Z');
    expect(JSON.stringify(events)).not.toMatch(/title|instruction|url|token|image/i);
  });
});

async function openLegacyDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('assets', { keyPath: 'assetId' });
      database.createObjectStore('meta', { keyPath: 'key' });
      database
        .createObjectStore('receipts', { keyPath: 'eventId' })
        .createIndex('by-session', 'sessionId');
      database.createObjectStore('sessions', { keyPath: 'sessionId' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
