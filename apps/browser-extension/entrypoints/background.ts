import { browser } from 'wxt/browser';
import { UnavailableAtriumGateway } from '@atrium-capture/atrium-client';

import { CaptureRepository } from '../src/database.js';
import { EditorService } from '../src/editor-service.js';
import { parseIncomingMessage } from '../src/messages.js';
import { BrowserPublicationService } from '../src/publication-service.js';
import { RecorderService } from '../src/recorder-service.js';
import { SerializedScreenshotCapture } from '../src/screenshot.js';

export default defineBackground(() => {
  const repository = new CaptureRepository();
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
  );
  const editor = new EditorService(repository, broadcastChanged);
  const publication = new BrowserPublicationService(repository, new UnavailableAtriumGateway());

  void publication.resumePending().catch(() => undefined);

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  type MessageSender = Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1];

  const handleMessage = async (rawMessage: unknown, sender: MessageSender) => {
    const message = parseIncomingMessage(rawMessage);
    if (!message) {
      return undefined;
    }

    switch (message.kind) {
      case 'capture.event':
        return recorder.handleEvent(message, sender);
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
        return editor.finalize(message.payload.commandId, message.payload.rawRetention);
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
    }
  };

  const isExtensionSender = (sender: MessageSender): boolean =>
    Boolean(sender.url?.startsWith(browser.runtime.getURL('')));

  browser.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
    void handleMessage(rawMessage, sender).then(
      (response) => sendResponse(response),
      () => {
        console.warn('message_handling_failed');
        sendResponse(undefined);
      },
    );
    return true;
  });
});
