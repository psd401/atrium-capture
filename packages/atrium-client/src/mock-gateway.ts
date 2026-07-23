import type {
  AtriumCapabilities,
  AtriumCollection,
  AtriumGateway,
  CreateMarkdownVersionRequest,
  CreatePrivateObjectRequest,
  UploadImmutableAssetRequest,
} from './index.js';
import { GatewayError } from './index.js';

export type MockFailurePoint =
  'create_object' | 'create_version' | 'publish_internal' | `upload_asset:${string}`;

interface MockObject {
  collectionId?: string;
  contentObjectId: string;
  title: string;
  visibility: 'internal' | 'private';
}

interface MockAsset {
  contentObjectId: string;
  localAssetId: string;
  mimeType: string;
  remoteAssetId: string;
  sha256: string;
  size: number;
}

interface MockVersion {
  contentObjectId: string;
  markdown: string;
  readerUrl: string;
  versionId: string;
}

export interface MockAtriumSnapshot {
  assets: MockAsset[];
  objects: MockObject[];
  requestCounts: Record<string, number>;
  versions: MockVersion[];
}

export interface MockAtriumGatewayOptions {
  collections?: AtriumCollection[];
  failAfterCommit?: readonly MockFailurePoint[];
}

const DEFAULT_COLLECTIONS: AtriumCollection[] = [
  { collectionId: '60000000-0000-4000-8000-000000000001', name: 'Synthetic guides' },
];

/**
 * A deterministic, in-memory Atrium boundary for tests and local development.
 * It models idempotency and private defaults without claiming production routes.
 */
export class MockAtriumGateway implements AtriumGateway {
  private readonly assetsByKey = new Map<string, MockAsset>();
  private readonly collections: AtriumCollection[];
  private readonly failedPoints = new Set<MockFailurePoint>();
  private readonly failurePlan: Set<MockFailurePoint>;
  private readonly objectsByKey = new Map<string, MockObject>();
  private readonly requestCounts = new Map<string, number>();
  private readonly versionsByKey = new Map<string, MockVersion>();
  private sequence = 1;

  constructor(options: MockAtriumGatewayOptions = {}) {
    this.collections = options.collections ?? DEFAULT_COLLECTIONS;
    this.failurePlan = new Set(options.failAfterCommit ?? []);
  }

  async capabilities(): Promise<AtriumCapabilities> {
    return {
      collectionDiscovery: true,
      idempotentWrites: true,
      immutableAssets: true,
      internalPublication: true,
      mode: 'mock',
      oauth: false,
      reasons: ['Synthetic local gateway; no production Atrium endpoint is configured.'],
    };
  }

  async createMarkdownVersion(
    request: CreateMarkdownVersionRequest,
  ): Promise<{ readerUrl: string; versionId: string }> {
    this.count('create_version');
    this.requireObject(request.contentObjectId);
    const existing = this.versionsByKey.get(request.idempotencyKey);
    if (existing) {
      this.assertSame(existing.contentObjectId, request.contentObjectId);
      this.assertSame(existing.markdown, request.markdown);
      return { readerUrl: existing.readerUrl, versionId: existing.versionId };
    }
    const versionId = this.nextId();
    const version: MockVersion = {
      contentObjectId: request.contentObjectId,
      markdown: request.markdown,
      readerUrl: `https://atrium.example.test/reader/${request.contentObjectId}`,
      versionId,
    };
    this.versionsByKey.set(request.idempotencyKey, version);
    this.failOnceAfterCommit('create_version');
    return { readerUrl: version.readerUrl, versionId };
  }

  async createPrivateObject(
    request: CreatePrivateObjectRequest,
  ): Promise<{ contentObjectId: string }> {
    this.count('create_object');
    if (request.visibility !== 'private') {
      throw new GatewayError('private_default_required', false);
    }
    const existing = this.objectsByKey.get(request.idempotencyKey);
    if (existing) {
      this.assertSame(existing.title, request.title);
      this.assertSame(existing.collectionId, request.collectionId);
      return { contentObjectId: existing.contentObjectId };
    }
    const contentObjectId = this.nextId();
    const object: MockObject = {
      contentObjectId,
      title: request.title,
      visibility: 'private',
      ...(request.collectionId ? { collectionId: request.collectionId } : {}),
    };
    this.objectsByKey.set(request.idempotencyKey, object);
    this.failOnceAfterCommit('create_object');
    return { contentObjectId };
  }

  formatAssetMarkdown(remoteAssetId: string, altText: string): string {
    return `![${escapeAltText(altText)}](mock-atrium-asset:${remoteAssetId})`;
  }

  async listCollections(): Promise<AtriumCollection[]> {
    this.count('list_collections');
    return structuredClone(this.collections);
  }

  async publishInternal(request: {
    contentObjectId: string;
    idempotencyKey: string;
  }): Promise<void> {
    this.count('publish_internal');
    const object = this.requireObject(request.contentObjectId);
    const existing = this.objectsByKey.get(request.idempotencyKey);
    if (existing) {
      this.assertSame(existing.contentObjectId, request.contentObjectId);
      return;
    }
    object.visibility = 'internal';
    this.objectsByKey.set(request.idempotencyKey, object);
    this.failOnceAfterCommit('publish_internal');
  }

  snapshot(): MockAtriumSnapshot {
    const uniqueObjects = new Map<string, MockObject>();
    for (const object of this.objectsByKey.values()) {
      uniqueObjects.set(object.contentObjectId, object);
    }
    return {
      assets: structuredClone([...this.assetsByKey.values()]),
      objects: structuredClone([...uniqueObjects.values()]),
      requestCounts: Object.fromEntries(this.requestCounts),
      versions: structuredClone([...this.versionsByKey.values()]),
    };
  }

  async uploadImmutableAsset(
    request: UploadImmutableAssetRequest,
  ): Promise<{ remoteAssetId: string }> {
    const failurePoint = `upload_asset:${request.localAssetId}` as const;
    this.count(failurePoint);
    this.requireObject(request.contentObjectId);
    if ((await sha256Hex(request.bytes)) !== request.sha256) {
      throw new GatewayError('asset_sha256_mismatch', false);
    }
    const existing = this.assetsByKey.get(request.idempotencyKey);
    if (existing) {
      this.assertSame(existing.contentObjectId, request.contentObjectId);
      this.assertSame(existing.localAssetId, request.localAssetId);
      this.assertSame(existing.sha256, request.sha256);
      return { remoteAssetId: existing.remoteAssetId };
    }
    const remoteAssetId = this.nextId();
    const asset: MockAsset = {
      contentObjectId: request.contentObjectId,
      localAssetId: request.localAssetId,
      mimeType: request.mimeType,
      remoteAssetId,
      sha256: request.sha256,
      size: request.bytes.size,
    };
    this.assetsByKey.set(request.idempotencyKey, asset);
    this.failOnceAfterCommit(failurePoint);
    return { remoteAssetId };
  }

  private assertSame(actual: unknown, expected: unknown): void {
    if (actual !== expected) {
      throw new GatewayError('idempotency_conflict', false);
    }
  }

  private count(operation: string): void {
    this.requestCounts.set(operation, (this.requestCounts.get(operation) ?? 0) + 1);
  }

  private failOnceAfterCommit(point: MockFailurePoint): void {
    if (this.failurePlan.has(point) && !this.failedPoints.has(point)) {
      this.failedPoints.add(point);
      throw new GatewayError('synthetic_connection_lost_after_commit', true);
    }
  }

  private nextId(): string {
    const suffix = String(this.sequence).padStart(12, '0');
    this.sequence += 1;
    return `80000000-0000-4000-8000-${suffix}`;
  }

  private requireObject(contentObjectId: string): MockObject {
    for (const object of this.objectsByKey.values()) {
      if (object.contentObjectId === contentObjectId) {
        return object;
      }
    }
    throw new GatewayError('content_object_not_found', false);
  }
}

function escapeAltText(value: string): string {
  return value.replace(/[\\\]]/g, '\\$&');
}

async function sha256Hex(bytes: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
