import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { GatewayError } from './index.js';
import { MockAtriumGateway, type MockAtriumGatewayOptions } from './mock-gateway.js';

const API_PREFIX = '/_mock/atrium-capture/v1';
const MAX_JSON_BYTES = 1_000_000;
const MAX_ASSET_BYTES = 16_000_000;

export interface MockAtriumServer {
  baseUrl: string;
  close(): Promise<void>;
  gateway: MockAtriumGateway;
}

export async function startMockAtriumServer(
  options: MockAtriumGatewayOptions = {},
): Promise<MockAtriumServer> {
  const gateway = new MockAtriumGateway(options);
  const server = createServer((request, response) => {
    void route(request, response, gateway);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('mock_server_address_unavailable');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}${API_PREFIX}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    gateway,
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  gateway: MockAtriumGateway,
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    if (!path.startsWith(API_PREFIX)) {
      return json(response, 404, { code: 'not_found' });
    }
    const relativePath = path.slice(API_PREFIX.length);
    if (request.method === 'GET' && relativePath === '/capabilities') {
      return json(response, 200, await gateway.capabilities());
    }
    if (request.method === 'GET' && relativePath === '/collections') {
      return json(response, 200, { collections: await gateway.listCollections() });
    }
    if (request.method === 'POST' && relativePath === '/objects') {
      const body = requireRecord(await readJson(request));
      const result = await gateway.createPrivateObject({
        idempotencyKey: requireString(body, 'idempotencyKey'),
        sourceRef: requireSourceRef(body.sourceRef),
        title: requireString(body, 'title'),
        visibility: requireLiteral(body, 'visibility', 'private'),
        ...(typeof body.collectionId === 'string' ? { collectionId: body.collectionId } : {}),
      });
      return json(response, 201, result);
    }
    const assetMatch = /^\/objects\/([^/]+)\/assets\/([^/]+)$/.exec(relativePath);
    if (request.method === 'PUT' && assetMatch?.[1] && assetMatch[2]) {
      const bytes = await readBody(request, MAX_ASSET_BYTES);
      const assetBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(assetBuffer).set(bytes);
      const result = await gateway.uploadImmutableAsset({
        bytes: new Blob([assetBuffer], { type: requireHeader(request, 'content-type') }),
        contentObjectId: decodeURIComponent(assetMatch[1]),
        idempotencyKey: requireHeader(request, 'idempotency-key'),
        localAssetId: decodeURIComponent(assetMatch[2]),
        mimeType: requireHeader(request, 'content-type'),
        pixelHeight: requirePositiveIntegerHeader(request, 'x-pixel-height'),
        pixelWidth: requirePositiveIntegerHeader(request, 'x-pixel-width'),
        sha256: requireHeader(request, 'x-content-sha256'),
      });
      return json(response, 201, result);
    }
    const versionMatch = /^\/objects\/([^/]+)\/versions$/.exec(relativePath);
    if (request.method === 'POST' && versionMatch?.[1]) {
      const body = requireRecord(await readJson(request));
      const result = await gateway.createMarkdownVersion({
        contentObjectId: decodeURIComponent(versionMatch[1]),
        idempotencyKey: requireString(body, 'idempotencyKey'),
        markdown: requireString(body, 'markdown'),
      });
      return json(response, 201, result);
    }
    const publicationMatch = /^\/objects\/([^/]+)\/publications\/internal$/.exec(relativePath);
    if (request.method === 'POST' && publicationMatch?.[1]) {
      const body = requireRecord(await readJson(request));
      await gateway.publishInternal({
        contentObjectId: decodeURIComponent(publicationMatch[1]),
        idempotencyKey: requireString(body, 'idempotencyKey'),
        versionId: requireString(body, 'versionId'),
      });
      return json(response, 204, undefined);
    }
    return json(response, 404, { code: 'not_found' });
  } catch (error) {
    if (error instanceof GatewayError) {
      return json(response, error.retryable ? 503 : 400, {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    }
    return json(response, 400, { code: 'invalid_request', retryable: false });
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const bytes = await readBody(request, MAX_JSON_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes =
      typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > limit) {
      throw new GatewayError('request_too_large', false);
    }
    chunks.push(bytes);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayError('invalid_json_object', false);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new GatewayError(`invalid_${key}`, false);
  }
  return value;
}

function requireLiteral<T extends string>(
  record: Record<string, unknown>,
  key: string,
  expected: T,
): T {
  if (record[key] !== expected) {
    throw new GatewayError(`invalid_${key}`, false);
  }
  return expected;
}

function requireHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new GatewayError(`missing_${name}`, false);
  }
  return value;
}

function requirePositiveIntegerHeader(request: IncomingMessage, name: string): number {
  const value = Number(requireHeader(request, name));
  if (!Number.isSafeInteger(value) || value < 1 || value > 12_000) {
    throw new GatewayError(`invalid_${name}`, false);
  }
  return value;
}

function requireSourceRef(value: unknown): {
  capturedAt: string;
  clientSurface: 'browser' | 'mac';
  clientVersion: string;
  externalId: string;
  provider: 'atrium-capture';
  sourceOrigins?: string[];
  type: 'capture';
} {
  const sourceRef = requireRecord(value);
  const clientSurface = requireString(sourceRef, 'clientSurface');
  if (clientSurface !== 'browser' && clientSurface !== 'mac') {
    throw new GatewayError('invalid_clientSurface', false);
  }
  if (sourceRef.provider !== 'atrium-capture' || sourceRef.type !== 'capture') {
    throw new GatewayError('invalid_sourceRef', false);
  }
  const capturedAt = requireString(sourceRef, 'capturedAt');
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new GatewayError('invalid_capturedAt', false);
  }
  const origins = sourceRef.sourceOrigins;
  if (
    origins !== undefined &&
    (!Array.isArray(origins) ||
      origins.length > 20 ||
      !origins.every((origin) => typeof origin === 'string' && origin.length <= 2_048))
  ) {
    throw new GatewayError('invalid_sourceOrigins', false);
  }
  return {
    capturedAt,
    clientSurface,
    clientVersion: requireString(sourceRef, 'clientVersion'),
    externalId: requireString(sourceRef, 'externalId'),
    provider: 'atrium-capture',
    ...(origins ? { sourceOrigins: origins as string[] } : {}),
    type: 'capture',
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('cache-control', 'no-store');
  if (body === undefined) {
    response.end();
    return;
  }
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
