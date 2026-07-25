import {
  Action,
  AtriumCaptureSessionState,
  SourceURLRetention,
  type Target,
} from '@atrium-capture/contracts';
import {
  SerialTaskQueue,
  classifyCaptureEvent,
  type NormalizedCaptureEvent,
} from '@atrium-capture/capture-core';
import {
  evaluateSiteAccess,
  retainBrowserLocation,
  type SourceUrlRetention,
} from '@atrium-capture/privacy';

import { CaptureRepository, type EventReceipt } from './database.js';
import { parseManagedPolicy, type ManagedPolicySnapshot } from './managed-policy.js';
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
    private readonly appVersion = '1.0.0',
    private readonly loadPolicy: () => Promise<ManagedPolicySnapshot> = async () =>
      parseManagedPolicy({}),
  ) {}

  getSnapshot() {
    return this.repository.getActiveSession();
  }

  command(command: 'new' | 'start' | 'pause' | 'resume' | 'stop', title = 'Untitled capture') {
    return this.queue.enqueue(async () => {
      let session;
      if (command === 'start' || command === 'new') {
        const managed = await this.loadPolicy();
        if (!managed.valid) {
          await this.recordHealth('managed_policy_invalid', 'error');
          throw new Error('managed_policy_invalid');
        }
        const options = {
          policyVersion: managed.policy.policyVersion,
          rawImageRetention: managed.policy.rawImageRetention,
          sourceUrlRetention: managed.policy.sourceUrlRetention as SourceURLRetention,
        };
        session =
          command === 'new'
            ? await this.repository.startNewSession(title, this.appVersion, new Date(), options)
            : await this.repository.startSession(title, this.appVersion, new Date(), options);
      } else {
        session = await this.repository.transition(command);
      }
      await this.recordHealth(
        command === 'start' || command === 'new' ? 'capture_started' : 'capture_state_changed',
      );
      await this.onChanged();
      return session;
    });
  }

  contentState(rawUrl: string): Promise<ContentRecorderState> {
    return this.queue.enqueue(async () => {
      const session = await this.repository.getActiveSession();
      const managed = await this.loadPolicy();
      const access = evaluateSiteAccess(rawUrl, managed.policy);
      return {
        active:
          managed.valid && session?.state === AtriumCaptureSessionState.Recording && access.allowed,
        sourceUrlRetention: effectiveRetention(
          (session?.policy.sourceUrlRetention ?? 'origin') as SourceUrlRetention,
          managed.policy.sourceUrlRetention,
        ),
      };
    });
  }

  handleEvent(message: CaptureEventMessage, sender: MessageSenderLike): Promise<EventReceipt> {
    return this.queue.enqueue(async () => {
      const senderUrl = sender.tab?.url;
      const windowId = sender.tab?.windowId;
      const managed = await this.loadPolicy();
      if (
        !managed.valid ||
        sender.frameId !== 0 ||
        sender.tab?.id === undefined ||
        windowId === undefined ||
        !senderUrl ||
        !evaluateSiteAccess(senderUrl, managed.policy).allowed
      ) {
        throw new Error('untrusted_content_sender');
      }

      let session = await this.repository.getActiveSession();
      const retention = effectiveRetention(
        (session?.policy.sourceUrlRetention ?? 'origin') as SourceUrlRetention,
        managed.policy.sourceUrlRetention,
      );
      const event: NormalizedCaptureEvent = {
        action: message.payload.action,
        eventId: message.payload.eventId,
        occurredAt: new Date(message.payload.occurredAt),
        ...(message.payload.shortcut ? { shortcut: message.payload.shortcut } : {}),
        ...(message.payload.target
          ? { target: sanitizeTarget(message.payload.target, senderUrl, retention) }
          : {}),
      };

      if (session?.state === AtriumCaptureSessionState.Recording) {
        const storage = await this.repository.storageSummary();
        if (
          storage.assetBytes >= managed.policy.maxStorageBytes ||
          session.steps.length >= managed.policy.maxSessionSteps
        ) {
          session = await this.repository.transition('pause');
          await this.recordHealth('capture_paused_quota', 'warning');
        }
      }

      let screenshot;
      if (
        session?.state === AtriumCaptureSessionState.Recording &&
        classifyCaptureEvent(session, event) === 'recorded' &&
        sender.tab.active !== false &&
        event.action !== Action.Shortcut
      ) {
        try {
          screenshot = await this.screenshots.capture(windowId);
        } catch {
          console.warn('screenshot_capture_failed');
          await this.recordHealth('screenshot_capture_failed', 'warning');
        }
      }

      if (screenshot) {
        const storage = await this.repository.storageSummary();
        if (storage.assetBytes + screenshot.blob.size > managed.policy.maxStorageBytes) {
          await this.repository.transition('pause');
          await this.recordHealth('capture_paused_quota', 'warning');
          screenshot = undefined;
        }
      }

      const receipt = await this.repository.applyEvent(event, screenshot);
      await this.onChanged();
      return receipt;
    });
  }

  private async recordHealth(
    code: Parameters<CaptureRepository['recordHealthEvent']>[0],
    severity: Parameters<CaptureRepository['recordHealthEvent']>[1] = 'info',
  ): Promise<void> {
    await this.repository.recordHealthEvent(code, severity).catch(() => undefined);
  }
}

function effectiveRetention(
  sessionRetention: SourceUrlRetention,
  currentRetention: SourceUrlRetention,
): SourceUrlRetention {
  const rank: Record<SourceUrlRetention, number> = { full: 2, none: 0, origin: 1 };
  return rank[currentRetention] < rank[sessionRetention] ? currentRetention : sessionRetention;
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
