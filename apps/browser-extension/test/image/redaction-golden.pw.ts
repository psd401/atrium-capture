import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

const rendererPath = path.resolve(import.meta.dirname, '../../src/image-renderer.ts');
const goldenPath = path.resolve(import.meta.dirname, '../goldens/redaction-export-v1.json');

test('flattens opaque redaction pixels and strips source PNG metadata', async ({ page }) => {
  const [bundle, golden] = await Promise.all([
    build({
      bundle: true,
      entryPoints: [rendererPath],
      format: 'iife',
      globalName: 'AtriumImageRenderer',
      platform: 'browser',
      write: false,
    }),
    readFile(goldenPath, 'utf8').then((value) => JSON.parse(value) as GoldenExpectation),
  ]);
  const source = bundle.outputFiles[0]?.text;
  if (!source) {
    throw new Error('image_renderer_bundle_missing');
  }

  await page.route('http://127.0.0.1/**', (route) =>
    route.fulfill({
      body: '<!doctype html><title>Synthetic image golden</title>',
      contentType: 'text/html',
    }),
  );
  await page.goto('http://127.0.0.1/image-golden');
  await page.addScriptTag({ content: source });
  const result = await page.evaluate(async () => {
    const renderer = (
      globalThis as typeof globalThis & {
        AtriumImageRenderer: {
          flattenImage: (
            source: Blob,
            options: {
              annotations: Array<{
                color?: string;
                geometry: { height: number; width: number; x: number; y: number };
                id: string;
                kind: string;
                text?: string;
              }>;
              crop: { height: number; width: number; x: number; y: number };
            },
          ) => Promise<{ blob: Blob; pixelHeight: number; pixelWidth: number; sha256: string }>;
          pngChunkTypes: (input: ArrayBuffer | Uint8Array) => string[];
        };
      }
    ).AtriumImageRenderer;
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 8;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('canvas_context_unavailable');
    }
    context.fillStyle = '#2255AA';
    context.fillRect(0, 0, 12, 8);
    context.fillStyle = '#FA1020';
    context.fillRect(4, 2, 4, 3);
    const plainSource = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('png_encode_failed'))),
        'image/png',
      ),
    );
    const marker = 'SYNTHETIC_SOURCE_METADATA_MUST_BE_REMOVED';
    const sourceWithMetadata = injectTextChunk(
      new Uint8Array(await plainSource.arrayBuffer()),
      marker,
    );
    const stableSourceBytes = new Uint8Array(sourceWithMetadata.byteLength);
    stableSourceBytes.set(sourceWithMetadata);
    const sourceChunks = renderer.pngChunkTypes(stableSourceBytes);
    const flattened = await renderer.flattenImage(
      new Blob([stableSourceBytes], { type: 'image/png' }),
      {
        annotations: [
          {
            color: '#FACC15',
            geometry: { height: 2, width: 2, x: 1, y: 1 },
            id: '10000000-0000-4000-8000-000000000001',
            kind: 'highlight',
          },
          {
            geometry: { height: 2, width: 2, x: 8, y: 1 },
            id: '10000000-0000-4000-8000-000000000002',
            kind: 'mosaic',
          },
          {
            color: '#DC2626',
            geometry: { height: 2, width: 3, x: 1, y: 5 },
            id: '10000000-0000-4000-8000-000000000003',
            kind: 'rectangle',
          },
          {
            color: '#DC2626',
            geometry: { height: 2, width: 3, x: 8, y: 5 },
            id: '10000000-0000-4000-8000-000000000004',
            kind: 'arrow',
          },
          {
            color: '#111827',
            geometry: { height: 3, width: 4, x: 4, y: 2 },
            id: '10000000-0000-4000-8000-000000000005',
            kind: 'redaction',
          },
        ],
        crop: { height: 6, width: 10, x: 1, y: 1 },
      },
    );
    const outputBytes = await flattened.blob.arrayBuffer();
    const outputChunks = renderer.pngChunkTypes(outputBytes);
    const bitmap = await createImageBitmap(flattened.blob);
    const output = document.createElement('canvas');
    output.width = bitmap.width;
    output.height = bitmap.height;
    const outputContext = output.getContext('2d', { willReadFrequently: true });
    if (!outputContext) {
      throw new Error('canvas_context_unavailable');
    }
    outputContext.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = outputContext.getImageData(0, 0, output.width, output.height).data;
    const redactedPixels: number[][] = [];
    for (let y = 1; y < 4; y += 1) {
      for (let x = 3; x < 7; x += 1) {
        const offset = (y * output.width + x) * 4;
        redactedPixels.push(Array.from(pixels.slice(offset, offset + 4)));
      }
    }
    return {
      markerPresent: new TextDecoder().decode(outputBytes).includes(marker),
      outputChunks,
      outputHeight: flattened.pixelHeight,
      outputWidth: flattened.pixelWidth,
      redactedPixels,
      sha256: flattened.sha256,
      sourceChunks,
    };

    function injectTextChunk(png: Uint8Array, text: string): Uint8Array {
      const type = new TextEncoder().encode('tEXt');
      const data = new TextEncoder().encode(`Comment\0${text}`);
      const chunk = new Uint8Array(12 + data.length);
      new DataView(chunk.buffer).setUint32(0, data.length);
      chunk.set(type, 4);
      chunk.set(data, 8);
      new DataView(chunk.buffer).setUint32(8 + data.length, crc32(chunk.slice(4, 8 + data.length)));
      const iendOffset = png.length - 12;
      const combined = new Uint8Array(png.length + chunk.length);
      combined.set(png.slice(0, iendOffset));
      combined.set(chunk, iendOffset);
      combined.set(png.slice(iendOffset), iendOffset + chunk.length);
      return combined;
    }

    function crc32(bytes: Uint8Array): number {
      let crc = 0xffffffff;
      for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
          crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
      }
      return (crc ^ 0xffffffff) >>> 0;
    }
  });

  expect(result.sourceChunks).toContain('tEXt');
  expect(result.outputChunks).not.toEqual(
    expect.arrayContaining(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']),
  );
  expect(result.markerPresent).toBe(false);
  expect(result.outputWidth).toBe(golden.outputWidth);
  expect(result.outputHeight).toBe(golden.outputHeight);
  expect(result.redactedPixels).toHaveLength(golden.redactedPixelCount);
  expect(
    result.redactedPixels.every((pixel) => pixel.join(',') === golden.redactionRgba.join(',')),
  ).toBe(true);
  expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
});

interface GoldenExpectation {
  outputHeight: number;
  outputWidth: number;
  redactedPixelCount: number;
  redactionRgba: number[];
}
