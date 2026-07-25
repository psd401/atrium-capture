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
          command: { kind: 'update_title', title: 'Synthetic renamed guide' },
          commandId: crypto.randomUUID(),
        },
      }),
    ).toBeTruthy();
    expect(
      parseIncomingMessage({
        kind: 'editor.command',
        payload: {
          command: { kind: 'update_title', title: 'x'.repeat(501) },
          commandId: crypto.randomUUID(),
        },
      }),
    ).toBeUndefined();
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
        },
      }),
    ).toBeUndefined();
    expect(
      parseIncomingMessage({
        kind: 'editor.command',
        payload: {
          command: {
            annotation: {
              arrowDirection: 'down_right',
              geometry: { height: 20, width: 100, x: 10, y: 10 },
              id: crypto.randomUUID(),
              kind: 'arrow',
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
        kind: 'editor.command',
        payload: {
          command: {
            annotation: {
              arrowDirection: 'sideways',
              geometry: { height: 20, width: 100, x: 10, y: 10 },
              id: crypto.randomUUID(),
              kind: 'arrow',
            },
            kind: 'add_annotation',
            stepId: crypto.randomUUID(),
          },
          commandId: crypto.randomUUID(),
        },
      }),
    ).toBeUndefined();
  });

  it('accepts publication control metadata but rejects tokens and screenshot bytes', () => {
    expect(parseIncomingMessage({ kind: 'publisher.sign-in' })).toBeTruthy();
    expect(parseIncomingMessage({ kind: 'publisher.sign-out' })).toBeTruthy();
    expect(
      parseIncomingMessage({
        kind: 'publisher.sign-in',
        payload: { accessToken: 'prohibited' },
      }),
    ).toBeUndefined();
    expect(
      parseIncomingMessage({
        kind: 'publisher.enqueue',
        payload: {
          collectionId: '60000000-0000-4000-8000-000000000001',
          commandId: '50000000-0000-4000-8000-000000000001',
        },
      }),
    ).toBeTruthy();
    expect(
      parseIncomingMessage({
        kind: 'publisher.enqueue',
        payload: {
          accessToken: 'prohibited',
          commandId: '50000000-0000-4000-8000-000000000001',
        },
      }),
    ).toBeUndefined();
    expect(
      parseIncomingMessage({
        kind: 'publisher.retry',
        payload: {
          imageBytes: 'prohibited',
          jobId: '50000000-0000-4000-8000-000000000001',
        },
      }),
    ).toBeUndefined();
  });

  it('allows a diagnostics request only without page-supplied content', () => {
    expect(parseIncomingMessage({ kind: 'diagnostics.snapshot' })).toBeTruthy();
    expect(
      parseIncomingMessage({
        kind: 'diagnostics.snapshot',
        payload: { title: 'prohibited' },
      }),
    ).toBeUndefined();
    expect(
      parseIncomingMessage({
        kind: 'diagnostics.clear-local-data',
        payload: { confirmation: 'DELETE_LOCAL_CAPTURE_DATA' },
      }),
    ).toBeTruthy();
    expect(
      parseIncomingMessage({
        kind: 'diagnostics.clear-local-data',
        payload: { confirmation: 'yes' },
      }),
    ).toBeUndefined();
  });

  it('allows only bounded native bridge controls', () => {
    expect(parseIncomingMessage({ kind: 'native-bridge.snapshot' })).toBeTruthy();
    expect(
      parseIncomingMessage({
        kind: 'native-bridge.set-enabled',
        payload: { enabled: true },
      }),
    ).toBeTruthy();
    expect(
      parseIncomingMessage({
        kind: 'native-bridge.set-enabled',
        payload: { enabled: true, imageData: 'synthetic-prohibited-bytes' },
      }),
    ).toBeUndefined();
  });
});
