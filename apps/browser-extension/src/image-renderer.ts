import {
  Kind,
  MIMEType,
  type AnnotationElement,
  type ArrowDirection,
  type Geometry,
} from '@atrium-capture/contracts';

import { arrowEndpoints } from './arrow-geometry.js';

export interface FlattenImageOptions {
  annotations?: readonly AnnotationElement[];
  crop?: Geometry;
}

export interface FlattenedImage {
  blob: Blob;
  mimeType: MIMEType.ImagePNG;
  pixelHeight: number;
  pixelWidth: number;
  sha256: string;
}

const prohibitedMetadataChunks = new Set(['eXIf', 'iTXt', 'tEXt', 'tIME', 'zTXt']);

export async function flattenImage(
  source: Blob,
  options: FlattenImageOptions,
): Promise<FlattenedImage> {
  const bitmap = await createImageBitmap(source);
  try {
    const crop = normalizeCrop(options.crop, bitmap.width, bitmap.height);
    const pixelWidth = Math.max(1, Math.round(crop.width));
    const pixelHeight = Math.max(1, Math.round(crop.height));
    const canvas = new OffscreenCanvas(pixelWidth, pixelHeight);
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) {
      throw new Error('canvas_context_unavailable');
    }

    context.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      pixelWidth,
      pixelHeight,
    );
    const transform = (geometry: Geometry): Geometry => ({
      height: geometry.height * (pixelHeight / crop.height),
      width: geometry.width * (pixelWidth / crop.width),
      x: (geometry.x - crop.x) * (pixelWidth / crop.width),
      y: (geometry.y - crop.y) * (pixelHeight / crop.height),
    });
    const annotations = options.annotations ?? [];
    for (const annotation of annotations.filter((item) => item.kind !== Kind.Redaction)) {
      renderAnnotation(canvas, context, annotation, transform(annotation.geometry));
    }
    // Opaque redactions are rendered last so no later effect can reveal or alter source pixels.
    for (const annotation of annotations.filter((item) => item.kind === Kind.Redaction)) {
      renderRedaction(context, transform(annotation.geometry), annotation.color);
    }

    const blob = await canvas.convertToBlob({ type: MIMEType.ImagePNG });
    const bytes = await blob.arrayBuffer();
    if (pngChunkTypes(bytes).some((chunk) => prohibitedMetadataChunks.has(chunk))) {
      throw new Error('export_contains_source_metadata');
    }
    return {
      blob,
      mimeType: MIMEType.ImagePNG,
      pixelHeight,
      pixelWidth,
      sha256: await sha256(bytes),
    };
  } finally {
    bitmap.close();
  }
}

export function pngChunkTypes(input: ArrayBuffer | Uint8Array): string[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < signature.length || !signature.every((byte, index) => bytes[index] === byte)) {
    throw new Error('invalid_png_signature');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      throw new Error('invalid_png_chunk');
    }
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    chunks.push(type);
    offset = end;
    if (type === 'IEND') {
      if (offset !== bytes.length) {
        throw new Error('png_trailing_bytes');
      }
      return chunks;
    }
  }
  throw new Error('png_missing_iend');
}

function renderAnnotation(
  canvas: OffscreenCanvas,
  context: OffscreenCanvasRenderingContext2D,
  annotation: AnnotationElement,
  geometry: Geometry,
): void {
  switch (annotation.kind) {
    case Kind.Arrow:
      renderArrow(context, geometry, annotation.arrowDirection, annotation.color);
      return;
    case Kind.Blur:
      renderBlur(canvas, context, geometry);
      return;
    case Kind.Highlight:
      context.save();
      context.fillStyle = withAlpha(annotation.color ?? '#FACC15', 0.34);
      context.fillRect(geometry.x, geometry.y, geometry.width, geometry.height);
      context.restore();
      return;
    case Kind.Mosaic:
      renderMosaic(context, geometry);
      return;
    case Kind.Rectangle:
      context.save();
      context.strokeStyle = annotation.color ?? '#DC2626';
      context.lineWidth = 4;
      context.strokeRect(geometry.x, geometry.y, geometry.width, geometry.height);
      context.restore();
      return;
    case Kind.Text:
      context.save();
      context.fillStyle = annotation.color ?? '#DC2626';
      context.font = `${Math.max(14, Math.min(36, geometry.height))}px sans-serif`;
      context.textBaseline = 'top';
      context.fillText(annotation.text ?? '', geometry.x, geometry.y, geometry.width);
      context.restore();
      return;
    case Kind.Redaction:
      renderRedaction(context, geometry, annotation.color);
  }
}

function renderRedaction(
  context: OffscreenCanvasRenderingContext2D,
  geometry: Geometry,
  color?: string,
): void {
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = color ?? '#111827';
  context.fillRect(
    Math.floor(geometry.x),
    Math.floor(geometry.y),
    Math.ceil(geometry.width),
    Math.ceil(geometry.height),
  );
  context.restore();
}

function renderArrow(
  context: OffscreenCanvasRenderingContext2D,
  geometry: Geometry,
  direction?: ArrowDirection,
  color?: string,
): void {
  const { endX, endY, startX, startY } = arrowEndpoints(geometry, direction);
  const angle = Math.atan2(endY - startY, endX - startX);
  const head = Math.max(8, Math.min(20, Math.min(geometry.width, geometry.height) / 2));
  context.save();
  context.strokeStyle = color ?? '#DC2626';
  context.fillStyle = color ?? '#DC2626';
  context.lineCap = 'round';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
  context.beginPath();
  context.moveTo(endX, endY);
  context.lineTo(
    endX - head * Math.cos(angle - Math.PI / 6),
    endY - head * Math.sin(angle - Math.PI / 6),
  );
  context.lineTo(
    endX - head * Math.cos(angle + Math.PI / 6),
    endY - head * Math.sin(angle + Math.PI / 6),
  );
  context.closePath();
  context.fill();
  context.restore();
}

function renderBlur(
  canvas: OffscreenCanvas,
  context: OffscreenCanvasRenderingContext2D,
  geometry: Geometry,
): void {
  const rect = integerIntersection(geometry, canvas.width, canvas.height);
  if (!rect) {
    return;
  }
  const temporary = new OffscreenCanvas(rect.width, rect.height);
  const temporaryContext = temporary.getContext('2d');
  if (!temporaryContext) {
    throw new Error('canvas_context_unavailable');
  }
  temporaryContext.filter = 'blur(8px)';
  temporaryContext.drawImage(
    canvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  context.drawImage(temporary, rect.x, rect.y);
}

function renderMosaic(context: OffscreenCanvasRenderingContext2D, geometry: Geometry): void {
  const rect = integerIntersection(geometry, context.canvas.width, context.canvas.height);
  if (!rect) {
    return;
  }
  const image = context.getImageData(rect.x, rect.y, rect.width, rect.height);
  const blockSize = 10;
  for (let blockY = 0; blockY < rect.height; blockY += blockSize) {
    for (let blockX = 0; blockX < rect.width; blockX += blockSize) {
      const width = Math.min(blockSize, rect.width - blockX);
      const height = Math.min(blockSize, rect.height - blockY);
      const color = averageBlock(image.data, image.width, blockX, blockY, width, height);
      for (let y = blockY; y < blockY + height; y += 1) {
        for (let x = blockX; x < blockX + width; x += 1) {
          const offset = (y * image.width + x) * 4;
          image.data[offset] = color[0];
          image.data[offset + 1] = color[1];
          image.data[offset + 2] = color[2];
          image.data[offset + 3] = color[3];
        }
      }
    }
  }
  context.putImageData(image, rect.x, rect.y);
}

function averageBlock(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  startX: number,
  startY: number,
  width: number,
  height: number,
): [number, number, number, number] {
  const totals = [0, 0, 0, 0];
  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      const offset = (y * imageWidth + x) * 4;
      totals[0] = (totals[0] ?? 0) + (pixels[offset] ?? 0);
      totals[1] = (totals[1] ?? 0) + (pixels[offset + 1] ?? 0);
      totals[2] = (totals[2] ?? 0) + (pixels[offset + 2] ?? 0);
      totals[3] = (totals[3] ?? 0) + (pixels[offset + 3] ?? 0);
    }
  }
  const count = width * height;
  return totals.map((total) => Math.round(total / count)) as [number, number, number, number];
}

function normalizeCrop(crop: Geometry | undefined, width: number, height: number): Geometry {
  if (!crop) {
    return { height, width, x: 0, y: 0 };
  }
  const x = Math.max(0, Math.min(width - 1, crop.x));
  const y = Math.max(0, Math.min(height - 1, crop.y));
  const right = Math.max(x + 1, Math.min(width, crop.x + crop.width));
  const bottom = Math.max(y + 1, Math.min(height, crop.y + crop.height));
  return { height: bottom - y, width: right - x, x, y };
}

function integerIntersection(
  geometry: Geometry,
  canvasWidth: number,
  canvasHeight: number,
): { height: number; width: number; x: number; y: number } | undefined {
  const x = Math.max(0, Math.floor(geometry.x));
  const y = Math.max(0, Math.floor(geometry.y));
  const right = Math.min(canvasWidth, Math.ceil(geometry.x + geometry.width));
  const bottom = Math.min(canvasHeight, Math.ceil(geometry.y + geometry.height));
  return right > x && bottom > y ? { height: bottom - y, width: right - x, x, y } : undefined;
}

function withAlpha(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

async function sha256(input: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
