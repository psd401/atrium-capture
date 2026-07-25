import type {
  AtriumCapabilities,
  AtriumCollection,
  AtriumGateway,
  CreateMarkdownVersionRequest,
  CreatePrivateObjectRequest,
  UpdateContentTitleRequest,
  UploadImmutableAssetRequest,
} from './index.js';
import { GatewayError } from './index.js';

const MAX_JSON_RESPONSE_BYTES = 1_000_000;
const API_PATH = '/api/v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ATRIUM_PRODUCTION_ORIGIN = 'https://aistudio.psd401.ai';
export const ATRIUM_BROWSER_PRODUCTION_OAUTH_CLIENT_ID = 'ae781263-20c0-4b0c-8a34-8be01ab72fb1';
export const ATRIUM_OAUTH_AUTHORIZATION_ENDPOINT = `${ATRIUM_PRODUCTION_ORIGIN}/api/oauth/auth`;
export const ATRIUM_OAUTH_TOKEN_ENDPOINT = `${ATRIUM_PRODUCTION_ORIGIN}/api/oauth/token`;
export const ATRIUM_OAUTH_REVOCATION_ENDPOINT = `${ATRIUM_PRODUCTION_ORIGIN}/api/oauth/revocation`;
export const ATRIUM_OAUTH_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'content:read',
  'content:create',
  'content:update',
  'content:publish_internal',
] as const;

export interface ProductionAtriumGatewayOptions {
  accessToken(): Promise<string>;
  configured?: () => Promise<boolean>;
  origin?: string;
  request?: typeof fetch;
}

interface ContentAsset {
  byteLength: number;
  contentType: string;
  embedRef: string;
  filename: string;
  height: number | null;
  id: string;
  objectId: string;
  purpose: 'capture_step' | 'document_image';
  sha256: string;
  state: 'deleted' | 'pending' | 'quarantined' | 'ready' | 'rejected';
  uploadExpiresAt: string;
  width: number | null;
}

interface InitiatedContentAsset extends ContentAsset {
  upload: {
    expiresAt: string;
    headers: {
      'content-type': string;
      'x-amz-checksum-sha256': string;
    };
    method: 'PUT';
    url: string;
  };
}

/**
 * Strict client for the documented AI Studio v1 Atrium contract.
 *
 * The caller owns OAuth token lifecycle. Every content response is bounded and
 * validated, and only the server-issued S3 PUT receives image bytes.
 */
export class ProductionAtriumGateway implements AtriumGateway {
  private readonly apiBaseUrl: string;
  private readonly origin: string;
  private readonly request: typeof fetch;

  constructor(private readonly options: ProductionAtriumGatewayOptions) {
    const origin = new URL(options.origin ?? ATRIUM_PRODUCTION_ORIGIN);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    ) {
      throw new Error('atrium_origin_invalid');
    }
    this.origin = origin.origin;
    this.apiBaseUrl = `${origin.origin}${API_PATH}`;
    this.request = options.request ?? fetch;
  }

  async capabilities(): Promise<AtriumCapabilities> {
    if (this.options.configured && !(await this.options.configured())) {
      return {
        collectionDiscovery: false,
        contentUpdates: false,
        idempotentWrites: false,
        immutableAssets: false,
        internalPublication: false,
        mode: 'live_unavailable',
        oauth: false,
        reasons: ['Atrium OAuth client registration is not configured.'],
      };
    }
    return {
      collectionDiscovery: true,
      contentUpdates: true,
      idempotentWrites: true,
      immutableAssets: true,
      internalPublication: true,
      mode: 'live',
      oauth: true,
      reasons: [],
    };
  }

  async createMarkdownVersion(
    request: CreateMarkdownVersionRequest,
  ): Promise<{ readerUrl: string; versionId: string }> {
    const response = await this.sendApiJson(
      `/content/${encodeURIComponent(request.contentObjectId)}/versions`,
      {
        body: request.markdown,
        bodyFormat: 'markdown',
        summary: 'Created by Atrium Capture after privacy review.',
      },
      {
        'idempotency-key': request.idempotencyKey,
        'if-match': '"none"',
      },
    );
    const data = requireDataRecord(response);
    const version = requireRecord(data.version);
    const versionId = requireUuid(version, 'id');
    const currentVersionId = requireUuid(data, 'currentVersionId');
    if (versionId !== currentVersionId) {
      throw new GatewayError('atrium_version_mismatch', false);
    }
    const slug = requireBoundedString(data, 'slug', 500);
    return {
      readerUrl: new URL(`/c/${encodeURIComponent(slug)}`, this.origin).toString(),
      versionId,
    };
  }

  async createPrivateObject(
    request: CreatePrivateObjectRequest,
  ): Promise<{ contentObjectId: string }> {
    if (request.visibility !== 'private') {
      throw new GatewayError('private_default_required', false);
    }
    const response = await this.sendApiJson(
      '/content',
      {
        kind: 'document',
        title: request.title,
        visibility: { level: 'private' },
        sourceRef: request.sourceRef,
        tags: ['atrium-capture'],
        ...(request.collectionId ? { collectionId: request.collectionId } : {}),
      },
      { 'idempotency-key': request.idempotencyKey },
    );
    const data = requireDataRecord(response);
    if (data.visibilityLevel !== 'private') {
      throw new GatewayError('atrium_private_default_violated', false);
    }
    if (data.currentVersionId !== null) {
      throw new GatewayError('atrium_bodyless_object_expected', false);
    }
    return { contentObjectId: requireUuid(data, 'id') };
  }

  formatAssetMarkdown(remoteAssetId: string, altText: string): string {
    if (!UUID_PATTERN.test(remoteAssetId)) {
      throw new GatewayError('atrium_asset_id_invalid', false);
    }
    const cleanAlt = altText
      .replace(/[\r\n"]/g, ' ')
      .trim()
      .slice(0, 500);
    return `::atrium-asset{id="${remoteAssetId.toLowerCase()}" alt="${cleanAlt}"}`;
  }

  async listCollections(): Promise<AtriumCollection[]> {
    const response = await this.getApiJson('/content/collections?shape=flat');
    const record = requireRecord(response);
    if (!Array.isArray(record.data) || record.data.length > 10_000) {
      throw new GatewayError('atrium_collections_invalid', false);
    }
    return record.data
      .map((candidate) => {
        const collection = requireRecord(candidate);
        const path = collection.path;
        if (
          !Array.isArray(path) ||
          path.length === 0 ||
          path.length > 100 ||
          !path.every((part) => typeof part === 'string' && part.length > 0 && part.length <= 500)
        ) {
          throw new GatewayError('atrium_collection_invalid', false);
        }
        return {
          collectionId: requireUuid(collection, 'id'),
          name: path.join(' / ').slice(0, 2_000),
          selectableForCreate: collection.selectableForCreate === true,
        };
      })
      .filter((collection) => collection.selectableForCreate)
      .map(({ collectionId, name }) => ({ collectionId, name }));
  }

  async publishInternal(request: {
    contentObjectId: string;
    idempotencyKey: string;
    versionId: string;
  }): Promise<void> {
    const response = await this.sendApiJson(
      `/content/${encodeURIComponent(request.contentObjectId)}/publish`,
      { destination: 'intranet' },
      {
        'idempotency-key': request.idempotencyKey,
        'if-match': `"${request.versionId}"`,
      },
    );
    const data = requireDataRecord(response);
    if (
      requireUuid(data, 'id') !== request.contentObjectId ||
      data.destination !== 'intranet' ||
      requireUuid(data, 'publishedVersionId') !== request.versionId
    ) {
      throw new GatewayError('atrium_publication_response_invalid', false);
    }
  }

  async updateContentTitle(
    request: UpdateContentTitleRequest,
  ): Promise<{ contentObjectId: string; title: string }> {
    const title = request.title.trim();
    if (!title || title.length > 500) {
      throw new GatewayError('invalid_title', false);
    }
    const response = await this.sendApiJson(
      `/content/${encodeURIComponent(request.contentObjectId)}`,
      { title },
      {},
      'PATCH',
    );
    const data = requireDataRecord(response);
    return {
      contentObjectId: requireUuid(data, 'id'),
      title: requireBoundedString(data, 'title', 500),
    };
  }

  async uploadImmutableAsset(
    request: UploadImmutableAssetRequest,
  ): Promise<{ remoteAssetId: string }> {
    const sha256 = hexDigestToBase64Url(request.sha256);
    const filename = assetFilename(request.localAssetId, request.mimeType);
    const existing = await this.findExistingAsset(request, filename, sha256);
    if (existing?.state === 'ready') {
      return { remoteAssetId: existing.id };
    }
    if (existing && (existing.state === 'pending' || existing.state === 'quarantined')) {
      try {
        const completed = await this.completeAsset(request.contentObjectId, existing.id, sha256);
        return { remoteAssetId: completed.id };
      } catch (error) {
        if (new Date(existing.uploadExpiresAt).getTime() > Date.now()) {
          throw error;
        }
      }
    }

    const initiated = await this.initiateAsset(request, filename, sha256);
    const uploadUrl = validateUploadUrl(initiated.upload.url);
    let uploadError: unknown;
    try {
      const uploadResponse = await this.request(uploadUrl, {
        body: await request.bytes.arrayBuffer(),
        headers: initiated.upload.headers,
        method: 'PUT',
      });
      if (!uploadResponse.ok) {
        uploadError = new GatewayError(
          'atrium_asset_upload_failed',
          uploadResponse.status >= 500 || uploadResponse.status === 429,
        );
      }
    } catch {
      uploadError = new GatewayError('atrium_asset_upload_failed', true);
    }

    try {
      const completed = await this.completeAsset(request.contentObjectId, initiated.id, sha256);
      return { remoteAssetId: completed.id };
    } catch (completeError) {
      if (uploadError instanceof GatewayError) {
        throw uploadError;
      }
      throw completeError;
    }
  }

  private async completeAsset(
    contentObjectId: string,
    remoteAssetId: string,
    sha256: string,
  ): Promise<ContentAsset> {
    const response = await this.sendApiJson(
      `/content/${encodeURIComponent(contentObjectId)}/assets/${encodeURIComponent(remoteAssetId)}/complete`,
      { sha256 },
    );
    const asset = parseContentAsset(requireDataRecord(response));
    if (asset.state !== 'ready' || asset.id !== remoteAssetId) {
      throw new GatewayError('atrium_asset_not_ready', true);
    }
    return asset;
  }

  private async findExistingAsset(
    request: UploadImmutableAssetRequest,
    filename: string,
    sha256: string,
  ): Promise<ContentAsset | undefined> {
    const response = await this.getApiJson(
      `/content/${encodeURIComponent(request.contentObjectId)}/assets`,
    );
    const record = requireRecord(response);
    if (!Array.isArray(record.data) || record.data.length > 10_000) {
      throw new GatewayError('atrium_assets_invalid', false);
    }
    const matches = record.data
      .map(parseContentAsset)
      .filter(
        (asset) =>
          asset.filename === filename &&
          asset.contentType === request.mimeType &&
          asset.byteLength === request.bytes.size &&
          asset.sha256 === sha256 &&
          asset.purpose === 'capture_step' &&
          asset.width === request.pixelWidth &&
          asset.height === request.pixelHeight,
      );
    return (
      matches.find((asset) => asset.state === 'ready') ??
      matches.find((asset) => asset.state === 'pending' || asset.state === 'quarantined')
    );
  }

  private async getApiJson(path: string): Promise<unknown> {
    const token = await this.requireAccessToken();
    const response = await this.request(`${this.apiBaseUrl}${path}`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'cache-control': 'no-store',
      },
    });
    return parseApiResponse(response);
  }

  private async initiateAsset(
    request: UploadImmutableAssetRequest,
    filename: string,
    sha256: string,
  ): Promise<InitiatedContentAsset> {
    const response = await this.sendApiJson(
      `/content/${encodeURIComponent(request.contentObjectId)}/assets`,
      {
        byteLength: request.bytes.size,
        contentType: request.mimeType,
        filename,
        height: request.pixelHeight,
        purpose: 'capture_step',
        sha256,
        width: request.pixelWidth,
      },
    );
    const data = requireDataRecord(response);
    const asset = parseContentAsset(data);
    const upload = requireRecord(data.upload);
    const headers = requireRecord(upload.headers);
    const contentType = requireBoundedString(headers, 'content-type', 100);
    const checksum = requireBoundedString(headers, 'x-amz-checksum-sha256', 100);
    if (
      asset.state !== 'pending' ||
      contentType !== request.mimeType ||
      upload.method !== 'PUT' ||
      typeof upload.url !== 'string' ||
      typeof upload.expiresAt !== 'string'
    ) {
      throw new GatewayError('atrium_asset_initiation_invalid', false);
    }
    return {
      ...asset,
      upload: {
        expiresAt: upload.expiresAt,
        headers: {
          'content-type': contentType,
          'x-amz-checksum-sha256': checksum,
        },
        method: 'PUT',
        url: upload.url,
      },
    };
  }

  private async requireAccessToken(): Promise<string> {
    if (this.options.configured && !(await this.options.configured())) {
      throw new GatewayError('atrium_oauth_client_unconfigured', false);
    }
    const token = await this.options.accessToken();
    if (!token || token.length > 16_384 || /[\r\n]/.test(token)) {
      throw new GatewayError('atrium_access_token_invalid', false);
    }
    return token;
  }

  private async sendApiJson(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
    method: 'PATCH' | 'POST' = 'POST',
  ): Promise<unknown> {
    const token = await this.requireAccessToken();
    const response = await this.request(`${this.apiBaseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'cache-control': 'no-store',
        'content-type': 'application/json',
        ...extraHeaders,
      },
      method,
    });
    return parseApiResponse(response);
  }
}

function assetFilename(localAssetId: string, mimeType: string): string {
  if (!UUID_PATTERN.test(localAssetId)) {
    throw new GatewayError('local_asset_id_invalid', false);
  }
  const extension =
    mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/webp'
          ? 'webp'
          : undefined;
  if (!extension) {
    throw new GatewayError('asset_mime_type_invalid', false);
  }
  return `atrium-capture-${localAssetId.toLowerCase()}.${extension}`;
}

function hexDigestToBase64Url(value: string): string {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new GatewayError('asset_sha256_invalid', false);
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseContentAsset(value: unknown): ContentAsset {
  const asset = requireRecord(value);
  const state = requireBoundedString(asset, 'state', 24);
  if (!['deleted', 'pending', 'quarantined', 'ready', 'rejected'].includes(state)) {
    throw new GatewayError('atrium_asset_state_invalid', false);
  }
  const purpose = requireBoundedString(asset, 'purpose', 32);
  if (purpose !== 'capture_step' && purpose !== 'document_image') {
    throw new GatewayError('atrium_asset_purpose_invalid', false);
  }
  return {
    byteLength: requirePositiveInteger(asset, 'byteLength', 20 * 1024 * 1024),
    contentType: requireBoundedString(asset, 'contentType', 100),
    embedRef: requireBoundedString(asset, 'embedRef', 1_000),
    filename: requireBoundedString(asset, 'filename', 255),
    height: requireNullablePositiveInteger(asset, 'height', 12_000),
    id: requireUuid(asset, 'id'),
    objectId: requireUuid(asset, 'objectId'),
    purpose,
    sha256: requireDigest(asset, 'sha256'),
    state: state as ContentAsset['state'],
    uploadExpiresAt: requireDateTime(asset, 'uploadExpiresAt'),
    width: requireNullablePositiveInteger(asset, 'width', 12_000),
  };
}

async function parseApiResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_JSON_RESPONSE_BYTES) {
    throw new GatewayError('atrium_response_too_large', false);
  }
  let body: unknown;
  try {
    body = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    throw new GatewayError('atrium_response_invalid', false);
  }
  if (!response.ok) {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const error =
      record.error && typeof record.error === 'object' ? requireRecord(record.error) : {};
    const code =
      typeof error.code === 'string' && error.code.length <= 100
        ? error.code.toLowerCase()
        : `atrium_http_${response.status}`;
    const message =
      typeof error.message === 'string' && error.message.length <= 1_000
        ? error.message
        : 'Atrium request failed.';
    const requestId =
      typeof record.requestId === 'string' && record.requestId.length <= 200
        ? record.requestId
        : response.headers.get('x-request-id')?.slice(0, 200);
    throw new GatewayError(
      code,
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500 ||
        code === 'idempotency_in_progress',
      message,
      requestId || undefined,
    );
  }
  return body;
}

function requireDataRecord(value: unknown): Record<string, unknown> {
  return requireRecord(requireRecord(value).data);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayError('atrium_response_invalid', false);
  }
  return value as Record<string, unknown>;
}

function requireBoundedString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new GatewayError('atrium_response_invalid', false);
  }
  return value;
}

function requireUuid(record: Record<string, unknown>, key: string): string {
  const value = requireBoundedString(record, key, 36);
  if (!UUID_PATTERN.test(value)) {
    throw new GatewayError('atrium_response_invalid', false);
  }
  return value.toLowerCase();
}

function requireDigest(record: Record<string, unknown>, key: string): string {
  const value = requireBoundedString(record, key, 43);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new GatewayError('atrium_response_invalid', false);
  }
  return value;
}

function requireDateTime(record: Record<string, unknown>, key: string): string {
  const value = requireBoundedString(record, key, 100);
  if (!Number.isFinite(Date.parse(value))) {
    throw new GatewayError('atrium_response_invalid', false);
  }
  return value;
}

function requirePositiveInteger(
  record: Record<string, unknown>,
  key: string,
  maximum: number,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new GatewayError('atrium_response_invalid', false);
  }
  return value;
}

function requireNullablePositiveInteger(
  record: Record<string, unknown>,
  key: string,
  maximum: number,
): number | null {
  if (record[key] === null) {
    return null;
  }
  return requirePositiveInteger(record, key, maximum);
}

function validateUploadUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !(
      url.hostname === 'amazonaws.com' ||
      url.hostname.endsWith('.amazonaws.com') ||
      url.hostname.endsWith('.amazonaws.com.cn')
    )
  ) {
    throw new GatewayError('atrium_asset_upload_url_invalid', false);
  }
  return url.toString();
}
