import { Action } from '@atrium-capture/contracts';
import { UnavailableAtriumGateway } from '@atrium-capture/atrium-client';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

import { CaptureRepository } from '../src/database.js';
import { DiagnosticsService } from '../src/diagnostics-service.js';
import { ManagedPolicyProvider } from '../src/managed-policy.js';
import { BrowserPublicationService } from '../src/publication-service.js';

const databaseName = `atrium-diagnostics-${crypto.randomUUID()}`;
const repository = new CaptureRepository(databaseName);

afterEach(async () => repository.deleteForTests());

describe('privacy-safe support diagnostics', () => {
  it('reports operational counts without capture content, URLs, IDs, or tokens', async () => {
    await repository.startSession('SYNTHETIC-PRIVATE-TITLE', '0.1.0');
    await repository.applyEvent({
      action: Action.Click,
      eventId: '40000000-0000-4000-8000-000000000001',
      occurredAt: new Date(1),
      target: {
        accessibleName: 'SYNTHETIC-PRIVATE-CONTROL',
        browser: {
          devicePixelRatio: 1,
          origin: 'https://private.example.test',
          viewportCss: { height: 100, width: 100 },
        },
      },
    });
    await repository.recordHealthEvent(
      'screenshot_capture_failed',
      'warning',
      new Date('2026-07-22T19:59:00.000Z'),
    );
    const managed = new ManagedPolicyProvider({
      async get() {
        return {};
      },
    });
    const publication = new BrowserPublicationService(repository, new UnavailableAtriumGateway());
    const diagnostics = new DiagnosticsService(
      repository,
      managed,
      publication,
      {
        extensionId: 'eomlblaiglafndhplfhilmdcaofhkkbj',
        async platform() {
          return { arch: 'arm64', os: 'mac' };
        },
        version: '0.1.0',
      },
      () => new Date('2026-07-22T20:00:00.000Z'),
    );

    const snapshot = await diagnostics.snapshot();
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.capture).toMatchObject({ state: 'recording', stepCount: 1 });
    expect(snapshot.privacy).toEqual({ captureContentIncluded: false, telemetryEnabled: false });
    expect(snapshot.health.events).toEqual([
      {
        code: 'screenshot_capture_failed',
        occurredAt: '2026-07-22T19:59:00.000Z',
        severity: 'warning',
      },
    ]);
    expect(serialized).not.toContain('SYNTHETIC-PRIVATE');
    expect(serialized).not.toContain('private.example.test');
    expect(serialized).not.toContain('10000000-');
    expect(serialized).not.toMatch(/access[_-]?token|refresh[_-]?token|bearer/i);
  });
});
