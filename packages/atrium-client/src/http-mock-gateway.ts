import type {
  AtriumCapabilities,
  AtriumCollection,
  AtriumGateway,
  CreateMarkdownVersionRequest,
  CreatePrivateObjectRequest,
  UploadImmutableAssetRequest,
} from './index.js';
import { GatewayError } from './index.js';

/** HTTP client for the versioned synthetic mock contract only. */
export class HttpMockAtriumGateway implements AtriumGateway {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly request: typeof fetch = fetch,
  ) {
    const parsed = new URL(baseUrl);
    if (!parsed.pathname.endsWith('/_mock/atrium-capture/v1')) {
      throw new Error('mock_gateway_url_required');
    }
    this.baseUrl = parsed.toString().replace(/\/$/, '');
  }

  async capabilities(): Promise<AtriumCapabilities> {
    return this.getJson('/capabilities', parseCapabilities);
  }

  async createMarkdownVersion(
    request: CreateMarkdownVersionRequest,
  ): Promise<{ readerUrl: string; versionId: string }> {
    return this.sendJson(
      `/objects/${encodeURIComponent(request.contentObjectId)}/versions`,
      request,
      parseVersion,
    );
  }

  async createPrivateObject(
    request: CreatePrivateObjectRequest,
  ): Promise<{ contentObjectId: string }> {
    return this.sendJson('/objects', request, parseObject);
  }

  formatAssetMarkdown(remoteAssetId: string, altText: string): string {
    return `![${altText.replace(/[\\\]]/g, '\\$&')}](mock-atrium-asset:${remoteAssetId})`;
  }

  async listCollections(): Promise<AtriumCollection[]> {
    const response = await this.getJson('/collections', parseCollections);
    return response.collections;
  }

  async publishInternal(request: {
    contentObjectId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.sendJson(
      `/objects/${encodeURIComponent(request.contentObjectId)}/publications/internal`,
      { idempotencyKey: request.idempotencyKey },
      () => undefined,
      true,
    );
  }

  async uploadImmutableAsset(
    request: UploadImmutableAssetRequest,
  ): Promise<{ remoteAssetId: string }> {
    const response = await this.request(
      `${this.baseUrl}/objects/${encodeURIComponent(request.contentObjectId)}/assets/${encodeURIComponent(request.localAssetId)}`,
      {
        body: await request.bytes.arrayBuffer(),
        headers: {
          'content-type': request.mimeType,
          'idempotency-key': request.idempotencyKey,
          'x-content-sha256': request.sha256,
        },
        method: 'PUT',
      },
    );
    return this.parseJson(response, parseAsset);
  }

  private async getJson<T>(path: string, validate: (value: unknown) => T): Promise<T> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      headers: { accept: 'application/json' },
    });
    return this.parseJson(response, validate);
  }

  private async parseJson<T>(response: Response, validate: (value: unknown) => T): Promise<T> {
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new GatewayError('mock_http_error', response.status >= 500);
      }
      if (body && typeof body === 'object' && 'code' in body) {
        const error = body as { code?: unknown; message?: unknown; retryable?: unknown };
        throw new GatewayError(
          typeof error.code === 'string' ? error.code : 'mock_http_error',
          typeof error.retryable === 'boolean' ? error.retryable : response.status >= 500,
          typeof error.message === 'string' ? error.message : 'Mock Atrium request failed.',
        );
      }
      throw new GatewayError('mock_http_error', response.status >= 500);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    try {
      return validate(await response.json());
    } catch (error) {
      if (error instanceof GatewayError) {
        throw error;
      }
      throw new GatewayError('invalid_mock_response', false);
    }
  }

  private async sendJson<T>(
    path: string,
    body: unknown,
    validate: (value: unknown) => T,
    allowEmpty = false,
  ): Promise<T> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
    if (allowEmpty && response.ok && response.status === 204) {
      return undefined as T;
    }
    return this.parseJson(response, validate);
  }
}

function parseCapabilities(value: unknown): AtriumCapabilities {
  const record = requireRecord(value);
  const mode = requireString(record, 'mode');
  if (mode !== 'mock') {
    throw new GatewayError('invalid_mock_mode', false);
  }
  const reasons = record.reasons;
  if (!Array.isArray(reasons) || !reasons.every((reason) => typeof reason === 'string')) {
    throw new GatewayError('invalid_mock_reasons', false);
  }
  return {
    collectionDiscovery: requireBoolean(record, 'collectionDiscovery'),
    idempotentWrites: requireBoolean(record, 'idempotentWrites'),
    immutableAssets: requireBoolean(record, 'immutableAssets'),
    internalPublication: requireBoolean(record, 'internalPublication'),
    mode,
    oauth: requireBoolean(record, 'oauth'),
    reasons,
  };
}

function parseCollections(value: unknown): { collections: AtriumCollection[] } {
  const collections = requireRecord(value).collections;
  if (!Array.isArray(collections) || collections.length > 1_000) {
    throw new GatewayError('invalid_mock_collections', false);
  }
  return {
    collections: collections.map((candidate) => {
      const record = requireRecord(candidate);
      return {
        collectionId: requireUuid(record, 'collectionId'),
        name: requireBoundedString(record, 'name', 500),
      };
    }),
  };
}

function parseObject(value: unknown): { contentObjectId: string } {
  return { contentObjectId: requireUuid(requireRecord(value), 'contentObjectId') };
}

function parseAsset(value: unknown): { remoteAssetId: string } {
  return { remoteAssetId: requireUuid(requireRecord(value), 'remoteAssetId') };
}

function parseVersion(value: unknown): { readerUrl: string; versionId: string } {
  const record = requireRecord(value);
  const readerUrl = requireBoundedString(record, 'readerUrl', 2_048);
  const parsed = new URL(readerUrl);
  if (parsed.protocol !== 'https:') {
    throw new GatewayError('invalid_mock_reader_url', false);
  }
  return { readerUrl, versionId: requireUuid(record, 'versionId') };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayError('invalid_mock_response', false);
  }
  return value as Record<string, unknown>;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new GatewayError('invalid_mock_response', false);
  }
  return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new GatewayError('invalid_mock_response', false);
  }
  return value;
}

function requireBoundedString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = requireString(record, key);
  if (value.length === 0 || value.length > maxLength) {
    throw new GatewayError('invalid_mock_response', false);
  }
  return value;
}

function requireUuid(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new GatewayError('invalid_mock_response', false);
  }
  return value;
}
