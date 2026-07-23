import { Action, AtriumCaptureSessionState, type Target } from '@atrium-capture/contracts';
import { SerialTaskQueue, type NormalizedCaptureEvent } from '@atrium-capture/capture-core';
import {
  evaluateSiteAccess,
  retainBrowserLocation,
  type SourceUrlRetention,
} from '@atrium-capture/privacy';

import { CaptureRepository, type EventReceipt } from './database.js';
import type { CaptureEventMessage } from './messages.js';
import { SerializedScreenshotCapture } from './screenshot.js';

export interface MessageSenderLike {
  frameId?: number | undefined;
  tab?:
    | {
        active?: boolean | undefined;
        id?: number | undefined;
        url?: string | undefined;
        windowId?: number | undefined;
      }
    | undefined;
}

export interface ContentRecorderState {
  active: boolean;
  sourceUrlRetention: SourceUrlRetention;
}

export class RecorderService {
  private readonly queue = new SerialTaskQueue();

  constructor(
    private readonly repository: CaptureRepository,
    private readonly screenshots: SerializedScreenshotCapture,
    private readonly onChanged: () => Promise<void>,
    private readonly appVersion = '0.1.0',
  ) {}

  getSnapshot() {
    return this.repository.getActiveSession();
  }

  command(command: 'start' | 'pause' | 'resume' | 'stop', title = 'Untitled capture') {
    return this.queue.enqueue(async () => {
      const session =
        command === 'start'
          ? await this.repository.startSession(title, this.appVersion)
          : await this.repository.transition(command);
      await this.onChanged();
      return session;
    });
  }

  contentState(rawUrl: string): Promise<ContentRecorderState> {
    return this.queue.enqueue(async () => {
      const session = await this.repository.getActiveSession();
      const access = evaluateSiteAccess(rawUrl, {});
      return {
        active: session?.state === AtriumCaptureSessionState.Recording && access.allowed,
        sourceUrlRetention: (session?.policy.sourceUrlRetention ?? 'origin') as SourceUrlRetention,
      };
    });
  }

  handleEvent(message: CaptureEventMessage, sender: MessageSenderLike): Promise<EventReceipt> {
    return this.queue.enqueue(async () => {
      const senderUrl = sender.tab?.url;
      const windowId = sender.tab?.windowId;
      if (
        sender.frameId !== 0 ||
        sender.tab?.id === undefined ||
        windowId === undefined ||
        !senderUrl ||
        !evaluateSiteAccess(senderUrl, {}).allowed
      ) {
        throw new Error('untrusted_content_sender');
      }

      const session = await this.repository.getActiveSession();
      const retention = (session?.policy.sourceUrlRetention ?? 'origin') as SourceUrlRetention;
      const event: NormalizedCaptureEvent = {
        action: message.payload.action,
        eventId: message.payload.eventId,
        occurredAt: new Date(message.payload.occurredAt),
        ...(message.payload.shortcut ? { shortcut: message.payload.shortcut } : {}),
        ...(message.payload.target
          ? { target: sanitizeTarget(message.payload.target, senderUrl, retention) }
          : {}),
      };

      let screenshot;
      if (
        session?.state === AtriumCaptureSessionState.Recording &&
        sender.tab.active !== false &&
        event.action !== Action.Shortcut
      ) {
        try {
          screenshot = await this.screenshots.capture(windowId);
        } catch {
          console.warn('screenshot_capture_failed');
        }
      }

      const receipt = await this.repository.applyEvent(event, screenshot);
      await this.onChanged();
      return receipt;
    });
  }
}

function sanitizeTarget(
  target: NonNullable<CaptureEventMessage['payload']['target']>,
  senderUrl: string,
  retention: SourceUrlRetention,
): Target {
  const retainedLocation = retainBrowserLocation(senderUrl, retention);
  const safeTarget: Target = {
    ...(target.accessibleName ? { accessibleName: target.accessibleName } : {}),
    ...(target.bounds ? { bounds: target.bounds } : {}),
    ...(target.role ? { role: target.role } : {}),
  };

  if (target.browser && retainedLocation) {
    safeTarget.browser = {
      devicePixelRatio: target.browser.devicePixelRatio,
      origin: retainedLocation.origin,
      viewportCss: target.browser.viewportCss,
      ...(retainedLocation.path ? { path: retainedLocation.path } : {}),
      ...(target.browser.pageTitle ? { pageTitle: target.browser.pageTitle } : {}),
      ...(target.browser.selectors ? { selectors: target.browser.selectors } : {}),
    };
  }

  return safeTarget;
}
