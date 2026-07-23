import { Action } from '@atrium-capture/contracts';
import { describe, expect, it } from 'vitest';

import { parseIncomingMessage } from '../src/messages.js';

describe('runtime message boundary', () => {
  const baseInputMessage = {
    kind: 'capture.event',
    payload: {
      action: Action.Input,
      eventId: '10000000-0000-4000-8000-000000000001',
      occurredAt: '2026-01-15T15:00:00.000Z',
      target: {
        accessibleName: 'Synthetic label',
        browser: {
          devicePixelRatio: 2,
          origin: 'https://fixture.test',
          viewportCss: { height: 720, width: 1280 },
        },
        role: 'textbox',
      },
    },
  };

  it('accepts a bounded semantic input-intent message', () => {
    expect(parseIncomingMessage(baseInputMessage)).toEqual(baseInputMessage);
  });

  it('rejects literal input values and unexpected privileged fields', () => {
    expect(
      parseIncomingMessage({
        ...baseInputMessage,
        payload: { ...baseInputMessage.payload, value: 'synthetic-but-prohibited' },
      }),
    ).toBeUndefined();
    expect(
      parseIncomingMessage({ ...baseInputMessage, accessToken: 'prohibited' }),
    ).toBeUndefined();
  });

  it('rejects malformed commands before they reach the service worker', () => {
    expect(
      parseIncomingMessage({
        kind: 'recorder.command',
        payload: { command: 'publish', commandId: crypto.randomUUID() },
      }),
    ).toBeUndefined();
  });

  it('accepts bounded editor commands and rejects image bytes at the message boundary', () => {
    expect(
      parseIncomingMessage({
        kind: 'editor.command',
        payload: {
          command: {
            annotation: {
              color: '#111827',
              geometry: { height: 20, width: 100, x: 10, y: 10 },
              id: crypto.randomUUID(),
              kind: 'redaction',
            },
            kind: 'add_annotation',
            stepId: crypto.randomUUID(),
          },
          commandId: crypto.randomUUID(),
        },
      }),
    ).toBeTruthy();
    expect(
      parseIncomingMessage({
        kind: 'editor.finalize',
        payload: {
          commandId: crypto.randomUUID(),
          rawImageBytes: 'prohibited',
          rawRetention: 'delete_after_flatten',
        },
      }),
    ).toBeUndefined();
  });
});
