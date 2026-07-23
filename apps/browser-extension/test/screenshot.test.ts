import { MIMEType } from '@atrium-capture/contracts';
import { describe, expect, it } from 'vitest';

import { SerializedScreenshotCapture } from '../src/screenshot.js';

describe('serialized screenshot capture', () => {
  it('never runs two visible-tab captures concurrently', async () => {
    let concurrent = 0;
    let maximumConcurrent = 0;
    let clock = 1_000;
    const calls: number[] = [];
    const capture = new SerializedScreenshotCapture(
      async (windowId) => {
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        calls.push(windowId);
        await Promise.resolve();
        concurrent -= 1;
        return `data:image/png;base64,${windowId}`;
      },
      () => clock,
      async (milliseconds) => {
        clock += milliseconds;
      },
      async () => ({
        blob: new Blob(['synthetic']),
        mimeType: MIMEType.ImagePNG,
        pixelHeight: 1,
        pixelWidth: 1,
        sha256: 'a'.repeat(64),
      }),
    );

    await Promise.all([capture.capture(10), capture.capture(20), capture.capture(30)]);

    expect(maximumConcurrent).toBe(1);
    expect(calls).toEqual([10, 20, 30]);
  });
});
