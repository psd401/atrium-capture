import { MIMEType } from '@atrium-capture/contracts';
import { SerialTaskQueue } from '@atrium-capture/capture-core';

import type { PreparedScreenshot } from './database.js';

const minimumCaptureIntervalMilliseconds = 650;

export class SerializedScreenshotCapture {
  private lastCaptureAt = 0;
  private readonly queue = new SerialTaskQueue();

  constructor(
    private readonly captureDataUrl: (windowId: number) => Promise<string>,
    private readonly now: () => number = Date.now,
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly prepare: (dataUrl: string) => Promise<PreparedScreenshot> = prepareScreenshot,
  ) {}

  capture(windowId: number): Promise<PreparedScreenshot> {
    return this.queue.enqueue(async () => {
      const remaining = minimumCaptureIntervalMilliseconds - (this.now() - this.lastCaptureAt);
      if (remaining > 0) {
        await this.delay(remaining);
      }

      this.lastCaptureAt = this.now();
      const dataUrl = await this.captureDataUrl(windowId);
      return this.prepare(dataUrl);
    });
  }
}

async function prepareScreenshot(dataUrl: string): Promise<PreparedScreenshot> {
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('capture_not_png');
  }

  const blob = await (await fetch(dataUrl)).blob();
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const bitmap = await createImageBitmap(blob);
  const dimensions = { pixelHeight: bitmap.height, pixelWidth: bitmap.width };
  bitmap.close();

  return {
    blob,
    mimeType: MIMEType.ImagePNG,
    ...dimensions,
    sha256,
  };
}
