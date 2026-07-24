import { type Action } from '@atrium-capture/contracts';
import { type EditorCommand } from '@atrium-capture/editor-model';

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

export interface EditorCommandMessage {
  kind: 'editor.command';
  payload: { command: EditorCommand; commandId: string };
}

export interface EditorFinalizeMessage {
  kind: 'editor.finalize';
  payload: {
    commandId: string;
  };
}

export interface EditorAssetMessage {
  kind: 'editor.asset';
  payload: { assetId: string };
}

export interface PublisherSnapshotMessage {
  kind: 'publisher.snapshot';
}

export interface PublisherSignInMessage {
  kind: 'publisher.sign-in';
}

export interface PublisherSignOutMessage {
  kind: 'publisher.sign-out';
}

export interface PublisherEnqueueMessage {
  kind: 'publisher.enqueue';
  payload: { collectionId?: string; commandId: string };
}

export interface PublisherRetryMessage {
  kind: 'publisher.retry';
  payload: { jobId: string };
}

export interface PublisherPublishInternalMessage {
  kind: 'publisher.publish-internal';
  payload: { jobId: string };
}

export interface DiagnosticsSnapshotMessage {
  kind: 'diagnostics.snapshot';
}

export interface DiagnosticsClearLocalDataMessage {
  kind: 'diagnostics.clear-local-data';
  payload: { confirmation: 'DELETE_LOCAL_CAPTURE_DATA' };
}

export interface NativeBridgeSnapshotMessage {
  kind: 'native-bridge.snapshot';
}

export interface NativeBridgeSetEnabledMessage {
  kind: 'native-bridge.set-enabled';
  payload: { enabled: boolean };
}

export type IncomingMessage =
  | CaptureEventMessage
  | RecorderCommandMessage
  | RecorderSnapshotMessage
  | ContentStateMessage
  | EditorCommandMessage
  | EditorFinalizeMessage
  | EditorAssetMessage
  | PublisherSnapshotMessage
  | PublisherSignInMessage
  | PublisherSignOutMessage
  | PublisherEnqueueMessage
  | PublisherRetryMessage
  | PublisherPublishInternalMessage
  | DiagnosticsSnapshotMessage
  | DiagnosticsClearLocalDataMessage
  | NativeBridgeSnapshotMessage
  | NativeBridgeSetEnabledMessage;

export function parseIncomingMessage(value: unknown): IncomingMessage | undefined {
  return validateMessage(value) ? (value as IncomingMessage) : undefined;
}
