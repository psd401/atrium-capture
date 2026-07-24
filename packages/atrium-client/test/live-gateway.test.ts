import { describe, expect, it } from 'vitest';

import { GatewayError } from '../src/index.js';
import {
  ATRIUM_BROWSER_PRODUCTION_OAUTH_CLIENT_ID,
  ProductionAtriumGateway,
} from '../src/live-gateway.js';

const OBJECT_ID = 'a1000000-0000-4000-8000-000000000001';
const ASSET_ID = 'a2000000-0000-4000-8000-000000000001';
const LOCAL_ASSET_ID = 'a3000000-0000-4000-8000-000000000001';
const VERSION_ID = 'a4000000-0000-4000-8000-000000000001';
const COLLECTION_ID = 'a5000000-0000-4000-8000-000000000001';
const DIGEST_HEX = '00'.repeat(32);
const DIGEST_BASE64URL = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('production Atrium v1 gateway', () => {
  it('ships the approved non-secret browser public client identifier', () => {
    expect(ATRIUM_BROWSER_PRODUCTION_OAUTH_CLIENT_ID).toBe('ae781263-20c0-4b0c-8a34-8be01ab72fb1');
  });

  it('uses documented private, immutable-asset, version, and publication contracts', async () => {
    const calls: Array<{ body?: unknown; headers: Headers; method: string; url: string }> = [];
    const gateway = new ProductionAtriumGateway({
      accessToken: async () => 'synthetic-access-token',
      configured: async () => true,
      request: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const headers = new Headers(init?.headers);
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body;
        calls.push({ ...(body === undefined ? {} : { body }), headers, method, url });

        if (url.endsWith('/content/collections?shape=flat')) {
          return json({
            data: [
              {
                id: COLLECTION_ID,
                path: ['Synthetic workspace', 'Guides'],
                selectableForCreate: true,
              },
              {
                id: 'a5000000-0000-4000-8000-000000000002',
                path: ['Read only'],
                selectableForCreate: false,
              },
            ],
          });
        }
        if (url.endsWith('/api/v1/content') && method === 'POST') {
          return json(
            {
              data: {
                currentVersionId: null,
                id: OBJECT_ID,
                slug: 'synthetic-guide',
                visibilityLevel: 'private',
              },
            },
            201,
          );
        }
        if (url.endsWith(`/content/${OBJECT_ID}/assets`) && method === 'GET') {
          return json({ data: [] });
        }
        if (url.endsWith(`/content/${OBJECT_ID}/assets`) && method === 'POST') {
          return json(
            {
              data: {
                ...asset('pending'),
                upload: {
                  expiresAt: '2026-07-24T20:15:00.000Z',
                  headers: {
                    'content-type': 'image/png',
                    'x-amz-checksum-sha256': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
                  },
                  method: 'PUT',
                  url: 'https://synthetic-bucket.s3.us-west-2.amazonaws.com/upload?signature=fake',
                },
              },
            },
            201,
          );
        }
        if (url.startsWith('https://synthetic-bucket.s3.us-west-2.amazonaws.com/')) {
          return new Response(undefined, { status: 200 });
        }
        if (url.endsWith(`/assets/${ASSET_ID}/complete`)) {
          return json({ data: asset('ready') });
        }
        if (url.endsWith(`/content/${OBJECT_ID}/versions`)) {
          return json(
            {
              data: {
                currentVersionId: VERSION_ID,
                slug: 'synthetic-guide',
                version: { id: VERSION_ID },
              },
            },
            201,
          );
        }
        if (url.endsWith(`/content/${OBJECT_ID}/publish`)) {
          return json({
            data: {
              destination: 'intranet',
              id: OBJECT_ID,
              publishedVersionId: VERSION_ID,
            },
          });
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Synthetic route missing.' } }, 404);
      },
    });

    expect(await gateway.listCollections()).toEqual([
      { collectionId: COLLECTION_ID, name: 'Synthetic workspace / Guides' },
    ]);
    const created = await gateway.createPrivateObject({
      collectionId: COLLECTION_ID,
      idempotencyKey: 'capture:job:create',
      sourceRef: {
        capturedAt: '2026-07-24T20:00:00.000Z',
        clientSurface: 'browser',
        clientVersion: '1.0.0',
        externalId: '10000000-0000-4000-8000-000000000001',
        provider: 'atrium-capture',
        sourceOrigins: ['https://fixture.example.test'],
        type: 'capture',
      },
      title: 'Synthetic guide',
      visibility: 'private',
    });
    const image = new Blob(['synthetic-reviewed-image'], { type: 'image/png' });
    const uploaded = await gateway.uploadImmutableAsset({
      bytes: image,
      contentObjectId: created.contentObjectId,
      idempotencyKey: 'capture:job:asset',
      localAssetId: LOCAL_ASSET_ID,
      mimeType: 'image/png',
      pixelHeight: 720,
      pixelWidth: 1280,
      sha256: DIGEST_HEX,
    });
    const version = await gateway.createMarkdownVersion({
      contentObjectId: created.contentObjectId,
      idempotencyKey: 'capture:job:version',
      markdown: `# Synthetic guide\n\n${gateway.formatAssetMarkdown(uploaded.remoteAssetId, 'Reviewed step')}`,
    });
    await gateway.publishInternal({
      contentObjectId: created.contentObjectId,
      idempotencyKey: 'capture:job:publish',
      versionId: version.versionId,
    });

    const createCall = calls.find(
      (call) => call.url.endsWith('/api/v1/content') && call.method === 'POST',
    );
    expect(createCall?.body).toMatchObject({
      kind: 'document',
      tags: ['atrium-capture'],
      visibility: { level: 'private' },
    });
    expect(createCall?.body).not.toHaveProperty('body');
    expect(createCall?.headers.get('authorization')).toBe('Bearer synthetic-access-token');
    expect(createCall?.headers.get('idempotency-key')).toBe('capture:job:create');

    const initiateCall = calls.find(
      (call) => call.url.endsWith(`/content/${OBJECT_ID}/assets`) && call.method === 'POST',
    );
    expect(initiateCall?.body).toEqual({
      byteLength: image.size,
      contentType: 'image/png',
      filename: `atrium-capture-${LOCAL_ASSET_ID}.png`,
      height: 720,
      purpose: 'capture_step',
      sha256: DIGEST_BASE64URL,
      width: 1280,
    });
    const uploadCall = calls.find((call) => call.url.includes('amazonaws.com/upload'));
    expect(uploadCall?.headers.get('authorization')).toBeNull();
    expect([...uploadCall!.headers.keys()].sort()).toEqual([
      'content-type',
      'x-amz-checksum-sha256',
    ]);

    const versionCall = calls.find((call) => call.url.endsWith(`/versions`));
    expect(versionCall?.headers.get('if-match')).toBe('"none"');
    expect(versionCall?.body).toMatchObject({ bodyFormat: 'markdown' });
    const publishCall = calls.find((call) => call.url.endsWith(`/publish`));
    expect(publishCall?.headers.get('if-match')).toBe(`"${VERSION_ID}"`);
    expect(version.readerUrl).toBe('https://aistudio.psd401.ai/c/synthetic-guide');
  });

  it('recovers a ready deterministic asset without reserving or uploading another', async () => {
    const methods: string[] = [];
    const gateway = new ProductionAtriumGateway({
      accessToken: async () => 'synthetic-access-token',
      request: async (input, init) => {
        methods.push(`${init?.method ?? 'GET'} ${String(input)}`);
        return json({ data: [asset('ready')] });
      },
    });

    await expect(
      gateway.uploadImmutableAsset({
        bytes: new Blob(['synthetic-reviewed-image'], { type: 'image/png' }),
        contentObjectId: OBJECT_ID,
        idempotencyKey: 'unused-by-production-asset-contract',
        localAssetId: LOCAL_ASSET_ID,
        mimeType: 'image/png',
        pixelHeight: 720,
        pixelWidth: 1280,
        sha256: DIGEST_HEX,
      }),
    ).resolves.toEqual({ remoteAssetId: ASSET_ID });
    expect(methods).toEqual([`GET https://aistudio.psd401.ai/api/v1/content/${OBJECT_ID}/assets`]);
  });

  it('completes a matching pending reservation without reserving or uploading another', async () => {
    const methods: string[] = [];
    const gateway = new ProductionAtriumGateway({
      accessToken: async () => 'synthetic-access-token',
      request: async (input, init) => {
        const methodAndUrl = `${init?.method ?? 'GET'} ${String(input)}`;
        methods.push(methodAndUrl);
        if (methodAndUrl.endsWith(`/content/${OBJECT_ID}/assets`)) {
          return json({ data: [asset('pending', '2099-01-01T00:00:00.000Z')] });
        }
        if (methodAndUrl.endsWith(`/assets/${ASSET_ID}/complete`)) {
          return json({ data: asset('ready') });
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Synthetic route missing.' } }, 404);
      },
    });

    await expect(gateway.uploadImmutableAsset(immutableAssetRequest())).resolves.toEqual({
      remoteAssetId: ASSET_ID,
    });
    expect(methods).toEqual([
      `GET https://aistudio.psd401.ai/api/v1/content/${OBJECT_ID}/assets`,
      `POST https://aistudio.psd401.ai/api/v1/content/${OBJECT_ID}/assets/${ASSET_ID}/complete`,
    ]);
  });

  it('recovers an ambiguous S3 response by completing the reserved asset exactly once', async () => {
    const methods: string[] = [];
    const gateway = new ProductionAtriumGateway({
      accessToken: async () => 'synthetic-access-token',
      request: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        methods.push(`${method} ${url}`);
        if (url.endsWith(`/content/${OBJECT_ID}/assets`) && method === 'GET') {
          return json({ data: [] });
        }
        if (url.endsWith(`/content/${OBJECT_ID}/assets`) && method === 'POST') {
          return initiatedAssetResponse(
            'https://synthetic-bucket.s3.us-west-2.amazonaws.com/upload?signature=fake',
          );
        }
        if (url.startsWith('https://synthetic-bucket.s3.us-west-2.amazonaws.com/')) {
          throw new TypeError('synthetic_transport_response_lost');
        }
        if (url.endsWith(`/assets/${ASSET_ID}/complete`)) {
          return json({ data: asset('ready') });
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Synthetic route missing.' } }, 404);
      },
    });

    await expect(gateway.uploadImmutableAsset(immutableAssetRequest())).resolves.toEqual({
      remoteAssetId: ASSET_ID,
    });
    expect(methods.filter((entry) => entry.endsWith(`/content/${OBJECT_ID}/assets`))).toHaveLength(
      2,
    );
    expect(methods.filter((entry) => entry.includes('amazonaws.com/upload'))).toHaveLength(1);
    expect(methods.filter((entry) => entry.endsWith(`/assets/${ASSET_ID}/complete`))).toHaveLength(
      1,
    );
  });

  it('rejects an untrusted upload URL before sending reviewed image bytes', async () => {
    const methods: string[] = [];
    let untrustedHostCalled = false;
    const gateway = new ProductionAtriumGateway({
      accessToken: async () => 'synthetic-access-token',
      request: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        methods.push(`${method} ${url}`);
        if (url.endsWith(`/content/${OBJECT_ID}/assets`) && method === 'GET') {
          return json({ data: [] });
        }
        if (url.endsWith(`/content/${OBJECT_ID}/assets`) && method === 'POST') {
          return initiatedAssetResponse('https://uploads.example.test/collect');
        }
        if (url.startsWith('https://uploads.example.test/')) {
          untrustedHostCalled = true;
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Synthetic route missing.' } }, 404);
      },
    });

    await expect(gateway.uploadImmutableAsset(immutableAssetRequest())).rejects.toMatchObject({
      code: 'atrium_asset_upload_url_invalid',
      retryable: false,
    });
    expect(untrustedHostCalled).toBe(false);
    expect(methods).not.toContain('PUT https://uploads.example.test/collect');
  });

  it('fails closed when OAuth registration or server responses are invalid', async () => {
    let tokenRequests = 0;
    const unconfigured = new ProductionAtriumGateway({
      accessToken: async () => {
        tokenRequests += 1;
        return 'must-not-be-read';
      },
      configured: async () => false,
    });

    expect(await unconfigured.capabilities()).toMatchObject({
      mode: 'live_unavailable',
      oauth: false,
    });
    await expect(unconfigured.listCollections()).rejects.toMatchObject({
      code: 'atrium_oauth_client_unconfigured',
      retryable: false,
    });
    expect(tokenRequests).toBe(0);

    const malformed = new ProductionAtriumGateway({
      accessToken: async () => 'synthetic-token',
      request: async () => json({ data: [{ id: 'not-a-uuid', path: ['Bad'] }] }),
    });
    await expect(malformed.listCollections()).rejects.toBeInstanceOf(GatewayError);
  });
});

function asset(state: 'pending' | 'ready', uploadExpiresAt = '2026-07-24T20:15:00.000Z') {
  return {
    byteLength: new Blob(['synthetic-reviewed-image']).size,
    contentType: 'image/png',
    embedRef: `::atrium-asset{id="${ASSET_ID}" alt=""}`,
    filename: `atrium-capture-${LOCAL_ASSET_ID}.png`,
    height: 720,
    id: ASSET_ID,
    objectId: OBJECT_ID,
    purpose: 'capture_step',
    sha256: DIGEST_BASE64URL,
    state,
    uploadExpiresAt,
    width: 1280,
  };
}

function immutableAssetRequest() {
  return {
    bytes: new Blob(['synthetic-reviewed-image'], { type: 'image/png' }),
    contentObjectId: OBJECT_ID,
    idempotencyKey: 'capture:job:asset',
    localAssetId: LOCAL_ASSET_ID,
    mimeType: 'image/png',
    pixelHeight: 720,
    pixelWidth: 1280,
    sha256: DIGEST_HEX,
  } as const;
}

function initiatedAssetResponse(uploadUrl: string): Response {
  return json(
    {
      data: {
        ...asset('pending', '2099-01-01T00:00:00.000Z'),
        upload: {
          expiresAt: '2099-01-01T00:00:00.000Z',
          headers: {
            'content-type': 'image/png',
            'x-amz-checksum-sha256': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          },
          method: 'PUT',
          url: uploadUrl,
        },
      },
    },
    201,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}
