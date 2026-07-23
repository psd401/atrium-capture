import { Action, AtriumCaptureSessionState } from '@atrium-capture/contracts';
import { describe, expect, it } from 'vitest';

import {
  SerialTaskQueue,
  createCaptureSession,
  reduceCaptureEvent,
  transitionSession,
  type NormalizedCaptureEvent,
} from '../src/index.js';

const ids = ['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'];

function makeIds(): () => string {
  let index = 0;
  return () => ids[index++] ?? `90000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function event(
  action: Action,
  milliseconds: number,
  eventId = crypto.randomUUID(),
): NormalizedCaptureEvent {
  return {
    action,
    eventId,
    occurredAt: new Date(1_700_000_000_000 + milliseconds),
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
}

describe('capture session state machine', () => {
  it('supports pause, resume, and stop without invalid transitions', () => {
    const session = createCaptureSession({
      idFactory: makeIds(),
      now: new Date(0),
      title: 'Test',
      appVersion: '0.1.0',
    });
    const paused = transitionSession(session, 'pause', new Date(1));
    const resumed = transitionSession(paused, 'resume', new Date(2));
    const stopped = transitionSession(resumed, 'stop', new Date(3));

    expect(paused.state).toBe(AtriumCaptureSessionState.Paused);
    expect(resumed.state).toBe(AtriumCaptureSessionState.Recording);
    expect(stopped.state).toBe(AtriumCaptureSessionState.Review);
    expect(transitionSession(stopped, 'resume')).toBe(stopped);
  });
});

describe('event reduction', () => {
  it('orders serialized events and merges low-value click duplicates', () => {
    const idFactory = makeIds();
    const session = createCaptureSession({
      idFactory,
      now: new Date(0),
      title: 'Test',
      appVersion: '0.1.0',
    });
    const first = reduceCaptureEvent(session, event(Action.Click, 0), idFactory);
    const duplicate = reduceCaptureEvent(first.session, event(Action.Click, 200), idFactory);
    const navigation = reduceCaptureEvent(
      duplicate.session,
      event(Action.Navigate, 1_000),
      idFactory,
    );

    expect(duplicate.disposition).toBe('merged');
    expect(navigation.session.steps.map((step) => step.sequence)).toEqual([0, 1]);
    expect(navigation.session.steps).toHaveLength(2);
  });

  it('merges repeated input intent without retaining a value', () => {
    const idFactory = makeIds();
    const session = createCaptureSession({ idFactory, title: 'Test', appVersion: '0.1.0' });
    const first = reduceCaptureEvent(session, event(Action.Input, 0), idFactory);
    const second = reduceCaptureEvent(first.session, event(Action.Input, 500), idFactory);
    const serialized = JSON.stringify(second.session);

    expect(second.disposition).toBe('merged');
    expect(second.session.steps).toHaveLength(1);
    expect(serialized).not.toMatch(/"value"/i);
    expect(second.session.steps[0]?.instruction.generatedText).toContain('requested value');
  });
});

describe('serial task queue', () => {
  it('finishes tasks in enqueue order even when later work is faster', async () => {
    const queue = new SerialTaskQueue();
    const order: number[] = [];
    const first = queue.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(1);
    });
    const second = queue.enqueue(async () => {
      order.push(2);
    });

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });
});
