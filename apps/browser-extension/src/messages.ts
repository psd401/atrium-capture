import { type Action } from '@atrium-capture/contracts';

import validateMessage from './generated/validate-extension-message.js';

export interface CaptureEventMessage {
  kind: 'capture.event';
  payload: {
    action: Action;
    eventId: string;
    occurredAt: string;
    shortcut?: string;
    target?: {
      accessibleName?: string;
      bounds?: { height: number; width: number; x: number; y: number };
      browser?: {
        devicePixelRatio: number;
        origin: string;
        pageTitle?: string;
        path?: string;
        selectors?: string[];
        viewportCss: { height: number; width: number };
      };
      role?: string;
    };
  };
}

export interface RecorderCommandMessage {
  kind: 'recorder.command';
  payload: {
    command: 'start' | 'pause' | 'resume' | 'stop';
    commandId: string;
  };
}

export interface RecorderSnapshotMessage {
  kind: 'recorder.snapshot';
}

export interface ContentStateMessage {
  kind: 'recorder.content-state';
  payload: { url: string };
}

export type IncomingMessage =
  CaptureEventMessage | RecorderCommandMessage | RecorderSnapshotMessage | ContentStateMessage;

export function parseIncomingMessage(value: unknown): IncomingMessage | undefined {
  return validateMessage(value) ? (value as IncomingMessage) : undefined;
}
