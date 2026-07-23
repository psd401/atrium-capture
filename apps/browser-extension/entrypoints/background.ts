import { browser } from 'wxt/browser';

import { CaptureRepository } from '../src/database.js';
import { parseIncomingMessage } from '../src/messages.js';
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
        if (!sender.url?.startsWith(browser.runtime.getURL(''))) {
          throw new Error('content_cannot_control_recorder');
        }
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        const title = activeTab?.title?.trim() || 'Untitled capture';
        return recorder.command(message.payload.command, title);
      }
      case 'recorder.snapshot':
        if (!sender.url?.startsWith(browser.runtime.getURL(''))) {
          throw new Error('content_cannot_read_session');
        }
        return recorder.getSnapshot();
    }
  };

  browser.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
    void handleMessage(rawMessage, sender).then(
      (response) => sendResponse(response),
      (error: unknown) => {
        console.warn(error instanceof Error ? error.message : 'message_handling_failed');
        sendResponse(undefined);
      },
    );
    return true;
  });
});
