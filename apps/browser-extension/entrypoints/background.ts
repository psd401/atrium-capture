import { browser } from 'wxt/browser';
import {
  ATRIUM_OAUTH_AUTHORIZATION_ENDPOINT,
  ATRIUM_OAUTH_REVOCATION_ENDPOINT,
  ATRIUM_OAUTH_SCOPES,
  ATRIUM_OAUTH_TOKEN_ENDPOINT,
  ProductionAtriumGateway,
} from '@atrium-capture/atrium-client/live';

import { BrowserOAuthSession, BrowserTrustedTokenStore } from '../src/browser-oauth.js';
import { CaptureRepository } from '../src/database.js';
import { DiagnosticsService } from '../src/diagnostics-service.js';
import { EditorService } from '../src/editor-service.js';
import { ManagedPolicyProvider } from '../src/managed-policy.js';
import { parseIncomingMessage } from '../src/messages.js';
import {
  createBrowserNativeBridgeAdapter,
  NativeBridgeService,
} from '../src/native-bridge-service.js';
import { BrowserPublicationService } from '../src/publication-service.js';
import { RecorderService } from '../src/recorder-service.js';
import { SerializedScreenshotCapture } from '../src/screenshot.js';

export default defineBackground(() => {
  const repository = new CaptureRepository();
  const managedPolicy = new ManagedPolicyProvider(browser.storage.managed);
  void browser.storage.managed
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch(() => undefined);
  void browser.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch(() => undefined);
  const auth = new BrowserOAuthSession(
    browser.identity,
    new BrowserTrustedTokenStore(browser.storage.session),
    async () => {
      const snapshot = await managedPolicy.load();
      const clientId = snapshot.valid ? snapshot.policy.atriumOAuthClientId : undefined;
      return clientId
        ? {
            authorizationEndpoint: ATRIUM_OAUTH_AUTHORIZATION_ENDPOINT,
            clientId,
            revocationEndpoint: ATRIUM_OAUTH_REVOCATION_ENDPOINT,
            scopes: [...ATRIUM_OAUTH_SCOPES],
            tokenEndpoint: ATRIUM_OAUTH_TOKEN_ENDPOINT,
          }
        : undefined;
    },
  );
  const atriumGateway = new ProductionAtriumGateway({
    accessToken: () => auth.accessToken(),
    configured: async () => {
      const snapshot = await managedPolicy.load();
      return Boolean(snapshot.valid && snapshot.policy.atriumOAuthClientId);
    },
  });
  const screenshotCapture = new SerializedScreenshotCapture((windowId) =>
    browser.tabs.captureVisibleTab(windowId, { format: 'png' }),
  );

  const broadcastChanged = async (): Promise<void> => {
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab) => tab.id !== undefined)
        .map((tab) =>
          browser.tabs
            .sendMessage(tab.id as number, { kind: 'recorder.refresh' })
            .catch(() => undefined),
        ),
    );
  };

  const recorder = new RecorderService(
    repository,
    screenshotCapture,
    broadcastChanged,
    browser.runtime.getManifest().version,
    () => managedPolicy.load(),
  );
  const editor = new EditorService(repository, broadcastChanged);
  const publication = new BrowserPublicationService(
    repository,
    atriumGateway,
    async () => {
      const snapshot = await managedPolicy.load();
      return snapshot.valid ? snapshot.policy.defaultCollectionId : undefined;
    },
    () => auth.status(),
  );
  const diagnostics = new DiagnosticsService(repository, managedPolicy, publication, {
    extensionId: browser.runtime.id,
    platform: async () => {
      const platform = await browser.runtime.getPlatformInfo();
      return { arch: platform.arch, os: platform.os };
    },
    version: browser.runtime.getManifest().version,
  });
  const nativeBridge = new NativeBridgeService(createBrowserNativeBridgeAdapter(browser));

  void repository.recordHealthEvent('worker_started').catch(() => undefined);

  void publication.resumePending().catch(() => undefined);

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  browser.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === 'managed') {
      void broadcastChanged();
    }
  });

  type MessageSender = Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1];

  const handleMessage = async (rawMessage: unknown, sender: MessageSender) => {
    const message = parseIncomingMessage(rawMessage);
    if (!message) {
      return undefined;
    }

    switch (message.kind) {
      case 'capture.event': {
        const result = await recorder.handleEvent(message, sender);
        void nativeBridge.forwardCaptureEvent(message).catch(() => undefined);
        return result;
      }
      case 'recorder.content-state': {
        if (!sender.tab?.url || sender.frameId !== 0) {
          throw new Error('untrusted_content_sender');
        }
        return recorder.contentState(sender.tab.url);
      }
      case 'recorder.command': {
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_control_recorder');
        }
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        const title = activeTab?.title?.trim() || 'Untitled capture';
        return recorder.command(message.payload.command, title);
      }
      case 'recorder.snapshot':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_read_session');
        }
        return recorder.getSnapshot();
      case 'editor.command':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_edit_session');
        }
        return editor.command(message.payload.commandId, message.payload.command);
      case 'editor.finalize':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_finalize_session');
        }
        {
          const snapshot = await managedPolicy.load();
          if (!snapshot.valid) {
            throw new Error('managed_policy_invalid');
          }
          const session = await repository.getActiveSession();
          const retention =
            session?.policy.rawImageRetention === 'delete_after_flatten' ||
            snapshot.policy.rawImageRetention === 'delete_after_flatten'
              ? 'delete_after_flatten'
              : 'delete_after_submit';
          return editor.finalize(message.payload.commandId, retention);
        }
      case 'editor.asset':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_read_asset');
        }
        return editor.assetDataUrl(message.payload.assetId);
      case 'publisher.snapshot':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_read_publisher');
        }
        return publication.snapshot();
      case 'publisher.sign-in':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_authenticate');
        }
        await auth.signIn();
        await broadcastChanged();
        return { authentication: await auth.status() };
      case 'publisher.sign-out':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_authenticate');
        }
        await auth.signOut();
        await broadcastChanged();
        return { authentication: await auth.status() };
      case 'publisher.enqueue':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_publish');
        }
        return publication.enqueue(message.payload.collectionId);
      case 'publisher.retry':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_publish');
        }
        return publication.resume(message.payload.jobId);
      case 'publisher.publish-internal':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_publish');
        }
        return publication.publishInternal(message.payload.jobId);
      case 'diagnostics.snapshot':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_read_diagnostics');
        }
        return diagnostics.snapshot();
      case 'diagnostics.clear-local-data':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_delete_local_data');
        }
        await repository.deleteAllLocalData();
        await broadcastChanged();
        return { cleared: true };
      case 'native-bridge.snapshot':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_read_native_bridge');
        }
        return nativeBridge.snapshot();
      case 'native-bridge.set-enabled':
        if (!isExtensionSender(sender)) {
          throw new Error('content_cannot_control_native_bridge');
        }
        return nativeBridge.setEnabled(message.payload.enabled);
    }
  };

  const isExtensionSender = (sender: MessageSender): boolean =>
    Boolean(sender.url?.startsWith(browser.runtime.getURL('')));

  browser.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
    void handleMessage(rawMessage, sender).then(
      (response) => sendResponse(response),
      () => {
        console.warn('message_handling_failed');
        void repository
          .recordHealthEvent('message_handling_failed', 'warning')
          .catch(() => undefined);
        sendResponse(undefined);
      },
    );
    return true;
  });
});
