import { describe, expect, it } from 'vitest';
import { Action } from '@atrium-capture/contracts';

import type { CaptureEventMessage } from '../src/messages.js';
import { NativeBridgeService, type NativeBridgeAdapter } from '../src/native-bridge-service.js';

class SyntheticAdapter implements NativeBridgeAdapter {
  public enabled = false;
  public permission = true;
  public readonly sent: object[] = [];
  public maliciousResponse = false;
  public extraResponseField = false;

  public async hasPermission() {
    return this.permission;
  }

  public async loadEnabled() {
    return this.enabled;
  }

  public async saveEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  public async send(message: object) {
    this.sent.push(message);
    const record = message as { messageId: string; type: string };
    if (this.maliciousResponse) {
      return {
        protocolVersion: 1,
        messageId: crypto.randomUUID(),
        correlationId: record.messageId,
        sentAt: new Date().toISOString(),
        type: 'session_state',
        payload: { imageData: 'synthetic-prohibited-bytes', code: 'ACCEPTED_METADATA_ONLY' },
      };
    }
    if (this.extraResponseField) {
      return {
        protocolVersion: 1,
        messageId: crypto.randomUUID(),
        correlationId: record.messageId,
        sentAt: new Date().toISOString(),
        type: 'session_state',
        payload: { code: 'ACCEPTED_METADATA_ONLY', url: 'https://synthetic.example.test' },
      };
    }
    return {
      protocolVersion: 1,
      messageId: crypto.randomUUID(),
      correlationId: record.messageId,
      sentAt: new Date().toISOString(),
      type: record.type === 'hello' ? 'hello_ack' : 'session_state',
      payload: { code: 'ACCEPTED_METADATA_ONLY' },
    };
  }
}

describe('optional metadata-only native bridge', () => {
  it('requires the optional Chrome permission before enabling', async () => {
    const adapter = new SyntheticAdapter();
    adapter.permission = false;
    const bridge = new NativeBridgeService(adapter);

    expect((await bridge.setEnabled(true)).statusCode).toBe('DISABLED');
    expect(adapter.enabled).toBe(false);
    expect(adapter.sent).toHaveLength(0);
  });

  it('forwards bounded semantic fields but no URL, pixels, token, or typed value', async () => {
    const adapter = new SyntheticAdapter();
    const bridge = new NativeBridgeService(adapter);
    expect((await bridge.setEnabled(true)).statusCode).toBe('READY');
    const message: CaptureEventMessage = {
      kind: 'capture.event',
      payload: {
        action: Action.Input,
        eventId: '10000000-0000-4000-8000-000000000099',
        occurredAt: '2026-01-15T15:00:00.000Z',
        target: {
          accessibleName: 'Synthetic account label',
          role: 'textbox',
          browser: {
            devicePixelRatio: 2,
            origin: 'https://synthetic.example.test',
            path: '/private-path',
            viewportCss: { width: 1200, height: 800 },
          },
        },
      },
    };

    await bridge.forwardCaptureEvent(message);
    const serialized = JSON.stringify(adapter.sent[1]);
    expect(serialized).toContain('Synthetic account label');
    expect(serialized).not.toContain('synthetic.example.test');
    expect(serialized).not.toContain('private-path');
    expect(serialized).not.toMatch(/screenshot|imageData|access[_-]?token|bearer|base64/i);
  });

  it('treats a native response containing image bytes as untrusted', async () => {
    const adapter = new SyntheticAdapter();
    adapter.maliciousResponse = true;
    const bridge = new NativeBridgeService(adapter);

    expect((await bridge.setEnabled(true)).statusCode).toBe('HOST_UNAVAILABLE');
  });

  it('requires an exact bounded response envelope', async () => {
    const adapter = new SyntheticAdapter();
    adapter.extraResponseField = true;
    const bridge = new NativeBridgeService(adapter);

    expect((await bridge.setEnabled(true)).statusCode).toBe('HOST_UNAVAILABLE');
  });
});
