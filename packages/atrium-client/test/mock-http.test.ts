import { describe, expect, it } from 'vitest';

import { HttpMockAtriumGateway } from '../src/http-mock-gateway.js';
import { startMockAtriumServer } from '../src/mock-server.js';

describe('versioned mock Atrium HTTP boundary', () => {
  it('supports private object, immutable asset, Markdown version, and explicit publication', async () => {
    const server = await startMockAtriumServer();
    try {
      const gateway = new HttpMockAtriumGateway(server.baseUrl);
      const capabilities = await gateway.capabilities();
      const collections = await gateway.listCollections();
      const object = await gateway.createPrivateObject({
        collectionId: collections[0]!.collectionId,
        idempotencyKey: 'synthetic-http-create-key',
        sourceRef: {
          capturedAt: '2026-01-15T15:00:00.000Z',
          clientSurface: 'browser',
          clientVersion: '0.1.0',
          externalId: '10000000-0000-4000-8000-000000000001',
          provider: 'atrium-capture',
          type: 'capture',
        },
        title: 'Synthetic HTTP guide',
        visibility: 'private',
      });
      const bytes = new Blob(['synthetic-http-image'], { type: 'image/png' });
      const asset = await gateway.uploadImmutableAsset({
        bytes,
        contentObjectId: object.contentObjectId,
        idempotencyKey: 'synthetic-http-asset-key',
        localAssetId: '30000000-0000-4000-8000-000000000001',
        mimeType: 'image/png',
        pixelHeight: 1,
        pixelWidth: 1,
        sha256: await sha256Hex(bytes),
      });
      const version = await gateway.createMarkdownVersion({
        contentObjectId: object.contentObjectId,
        idempotencyKey: 'synthetic-http-version-key',
        markdown: `# Synthetic\n\n${gateway.formatAssetMarkdown(asset.remoteAssetId, 'Step 1')}\n`,
      });

      expect(capabilities.mode).toBe('mock');
      expect(version.readerUrl).toContain(object.contentObjectId);
      expect(server.gateway.snapshot().objects[0]?.visibility).toBe('private');

      await gateway.publishInternal({
        contentObjectId: object.contentObjectId,
        idempotencyKey: 'synthetic-http-publish-key',
        versionId: version.versionId,
      });

      expect(server.gateway.snapshot().objects[0]?.visibility).toBe('internal');
      expect(server.gateway.snapshot().assets).toHaveLength(1);
      expect(server.gateway.snapshot().versions).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('rejects non-mock routes to avoid implying undocumented production APIs', () => {
    expect(() => new HttpMockAtriumGateway('https://atrium.example.test/api')).toThrow(
      'mock_gateway_url_required',
    );
  });
});

async function sha256Hex(bytes: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
