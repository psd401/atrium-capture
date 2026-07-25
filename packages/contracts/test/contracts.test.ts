import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  ArrowDirection,
  type AtriumCaptureNativeBridgeMessage,
  type AtriumCapturePublishJob,
  type AtriumCaptureSession,
} from '../src/index.js';

async function readFixture<T>(name: string): Promise<T> {
  const url = new URL(`../../test-fixtures/fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8')) as T;
}

describe('generated contract fixtures', () => {
  it('loads the shared capture session without retaining typed values', async () => {
    const session = await readFixture<AtriumCaptureSession>('capture-session-v1.json');
    const inputStep = session.steps.find((step) => step.action === 'input');

    expect(session.schemaVersion).toBe('1.0');
    expect(session.policy.rawImageRetention).toBe('delete_after_flatten');
    expect(inputStep?.instruction.generatedText).toContain('Enter the requested value');
    expect(inputStep).not.toHaveProperty('value');
    expect(inputStep?.target).not.toHaveProperty('value');
  });

  it('decodes the shared macOS capture fixture', async () => {
    const session = await readFixture<AtriumCaptureSession>('capture-session-macos-v1.json');

    expect(session.recorder.surface).toBe('macos');
    expect(session.steps).toHaveLength(2);
    expect(session.steps[1]?.instruction.generatedText).toBe(
      'Enter the requested value in Synthetic account label.',
    );
    expect(session.steps[0]?.target?.macos?.backingScaleFactor).toBe(2);
    expect(session.steps[0]?.annotations?.[0]?.arrowDirection).toBe(ArrowDirection.DownRight);
  });

  it('loads a metadata-only native bridge envelope', async () => {
    const message = await readFixture<AtriumCaptureNativeBridgeMessage>('native-bridge-v1.json');
    const serialized = JSON.stringify(message);

    expect(message.protocolVersion).toBe(1);
    expect(serialized).not.toMatch(/data:image|bearer|access[_-]?token/i);
  });

  it('loads a private-default queued publish job', async () => {
    const job = await readFixture<AtriumCapturePublishJob>('publish-job-v1.json');

    expect(job.phase).toBe('queued');
    expect(job.contentObjectId).toBeUndefined();
  });

  it('loads the shared ready-draft reader link', async () => {
    const job = await readFixture<AtriumCapturePublishJob>('publish-job-ready-v1.json');

    expect(job.phase).toBe('ready_as_draft');
    expect(job.readerUrl).toBe(
      'https://atrium.example.test/reader/70000000-0000-4000-8000-000000000001',
    );
  });
});
