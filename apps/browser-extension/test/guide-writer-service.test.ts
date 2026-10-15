// ABOUTME: Covers GuideWriterService availability gating, policy refusal, successful
// ABOUTME: suggestion application, failure handling, and the forbidden-for-session latch.
import { MockAtriumGateway } from '@atrium-capture/atrium-client/mock';
import { Action, Source } from '@atrium-capture/contracts';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

import { CaptureRepository } from '../src/database.js';
import { EditorService } from '../src/editor-service.js';
import { GuideWriterService } from '../src/guide-writer-service.js';
import { parseManagedPolicy, type ManagedPolicySnapshot } from '../src/managed-policy.js';

const repository = new CaptureRepository(`atrium-guide-writer-${crypto.randomUUID()}`);
const editor = new EditorService(repository, async () => undefined);

afterEach(async () => {
  await repository.deleteForTests();
});

function policy(overrides: Record<string, unknown> = {}): () => Promise<ManagedPolicySnapshot> {
  return async () =>
    parseManagedPolicy({ atriumGuideWriterAssistantId: 42, schemaVersion: 1, ...overrides });
}

async function recordStep(): Promise<void> {
  await repository.applyEvent({
    action: Action.Click,
    eventId: crypto.randomUUID(),
    occurredAt: new Date(1),
  });
}

async function reviewedSession(): Promise<string> {
  await repository.startSession('Synthetic guide', '0.1.0');
  const session = await repository.getActiveSession();
  await recordStep();
  await repository.transition('stop');
  await editor.command(crypto.randomUUID(), { kind: 'approve_clear_steps' });
  return session!.sessionId;
}

describe('guide writer service', () => {
  it('reports why the writer is unavailable', async () => {
    const gateway = new MockAtriumGateway();
    expect(
      await new GuideWriterService(
        repository,
        editor,
        gateway,
        policy({ aiGuideWriting: 'off' }),
      ).availability(),
    ).toEqual({ available: false, reason: 'policy_off' });
    expect(
      await new GuideWriterService(repository, editor, gateway, async () =>
        parseManagedPolicy({ schemaVersion: 1 }),
      ).availability(),
    ).toEqual({ available: false, reason: 'assistant_unconfigured' });
    expect(
      await new GuideWriterService(repository, editor, gateway, policy()).availability(),
    ).toEqual({ available: true });
  });

  it('refuses to call the gateway when policy is off even if asked', async () => {
    await reviewedSession();
    let executed = false;
    const gateway = new MockAtriumGateway();
    const original = gateway.executeGuideWriter.bind(gateway);
    gateway.executeGuideWriter = async (request) => {
      executed = true;
      return original(request);
    };
    const service = new GuideWriterService(
      repository,
      editor,
      gateway,
      policy({ aiGuideWriting: 'off' }),
    );
    expect(await service.write(crypto.randomUUID())).toMatchObject({
      ok: false,
      errorCode: 'policy_off',
    });
    expect(executed).toBe(false);
  });

  it('writes a suggestion into the reviewed session and keeps user edits', async () => {
    const sessionId = await reviewedSession();
    const before = await repository.getActiveSession();
    const firstStepId = before!.steps[0]!.stepId;
    await editor.command(crypto.randomUUID(), {
      kind: 'update_instruction',
      stepId: firstStepId,
      text: 'My own words.',
    });
    const service = new GuideWriterService(repository, editor, new MockAtriumGateway(), policy());

    const outcome = await service.write(crypto.randomUUID());

    expect(outcome.ok).toBe(true);
    const after = await repository.getActiveSession();
    expect(after?.sessionId).toBe(sessionId);
    expect(after?.title).toBe('Synthetic written guide');
    expect(after?.steps[0]?.instruction.editedText).toBe('My own words.');
    expect(after?.steps[0]?.instruction.source).toBe(Source.DistrictAI);
    expect(after?.steps[0]?.instruction.title).toBe('Step 1');
  });

  it('leaves the session unchanged and reports a retryable error when the job fails', async () => {
    await reviewedSession();
    const before = await repository.getActiveSession();
    const service = new GuideWriterService(
      repository,
      editor,
      new MockAtriumGateway({ guideWriter: { fail: 'failed' } }),
      policy(),
    );
    expect(await service.write(crypto.randomUUID())).toEqual({
      errorCode: 'atrium_job_failed',
      ok: false,
      retryable: true,
    });
    expect(await repository.getActiveSession()).toEqual(before);
    expect((await repository.listHealthEvents()).map((event) => event.code)).toContain(
      'guide_writer_failed',
    );
  });

  it('rejects an invalid suggestion without applying any command', async () => {
    await reviewedSession();
    const before = await repository.getActiveSession();
    const service = new GuideWriterService(
      repository,
      editor,
      new MockAtriumGateway({ guideWriter: { text: '{"schemaVersion":1,"steps":[]}' } }),
      policy(),
    );
    expect(await service.write(crypto.randomUUID())).toMatchObject({
      errorCode: 'suggestion_invalid',
      ok: false,
      retryable: true,
    });
    expect(await repository.getActiveSession()).toEqual(before);
  });

  it('treats a 403 as policy off for the rest of the session', async () => {
    await reviewedSession();
    const service = new GuideWriterService(
      repository,
      editor,
      new MockAtriumGateway({ guideWriter: { fail: 'forbidden' } }),
      policy(),
    );
    expect(await service.write(crypto.randomUUID())).toMatchObject({ ok: false, retryable: false });
    expect(await service.availability()).toEqual({ available: false, reason: 'policy_off' });
  });

  it('refuses before review is complete and before any network call', async () => {
    await repository.startSession('Synthetic guide', '0.1.0');
    await recordStep();
    await repository.transition('stop');
    let executed = false;
    const gateway = new MockAtriumGateway();
    gateway.executeGuideWriter = async () => {
      executed = true;
      return { jobId: 'x', text: '{}' };
    };
    const service = new GuideWriterService(repository, editor, gateway, policy());
    expect(await service.write(crypto.randomUUID())).toMatchObject({
      errorCode: 'privacy_review_incomplete',
      ok: false,
    });
    expect(executed).toBe(false);
  });
});
