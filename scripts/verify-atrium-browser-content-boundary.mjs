import { createRequire } from 'node:module';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/browser-extension/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionId = 'eomlblaiglafndhplfhilmdcaofhkkbj';
const extensionPath = path.join(repositoryRoot, 'apps/browser-extension/.output/chrome-mv3');
const userDataDirectory = await mkdtemp(path.join(tmpdir(), 'atrium-capture-boundary-'));
const origin = 'https://aistudio.psd401.ai';
const contentId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';

let context;
try {
  await access(path.join(extensionPath, 'manifest.json'));
  context = await chromium.launchPersistentContext(userDataDirectory, {
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-default-browser-check',
      '--no-first-run',
    ],
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    serviceWorkers: 'allow',
  });
  const worker = await extensionWorker(context);
  const checks = await worker.evaluate(
    async ({ assetId: syntheticAssetId, contentId: syntheticContentId, origin: apiOrigin }) => {
      const commonHeaders = {
        accept: 'application/json',
        authorization: 'Bearer synthetic-invalid-token',
        'cache-control': 'no-store',
      };
      const requests = [
        {
          label: 'collection_discovery',
          path: '/api/v1/content/collections?shape=flat',
        },
        {
          body: JSON.stringify({
            kind: 'document',
            sourceRef: {
              capturedAt: '2026-01-15T15:00:00.000Z',
              clientSurface: 'browser',
              clientVersion: '1.0.0',
              externalId: '10000000-0000-4000-8000-000000000001',
              provider: 'atrium-capture',
              sourceOrigins: ['https://fixture.example.test'],
              type: 'capture',
            },
            tags: ['atrium-capture'],
            title: 'Synthetic boundary check',
            visibility: { level: 'private' },
          }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'synthetic-boundary',
          },
          label: 'private_draft_creation',
          method: 'POST',
          path: '/api/v1/content',
        },
        {
          body: JSON.stringify({ title: 'Synthetic boundary check' }),
          headers: { 'content-type': 'application/json' },
          label: 'title_update',
          method: 'PATCH',
          path: `/api/v1/content/${syntheticContentId}`,
        },
        {
          label: 'asset_recovery',
          path: `/api/v1/content/${syntheticContentId}/assets`,
        },
        {
          body: JSON.stringify({
            byteLength: 1,
            contentType: 'image/png',
            filename: 'synthetic.png',
            height: 1,
            purpose: 'capture_step',
            sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            width: 1,
          }),
          headers: { 'content-type': 'application/json' },
          label: 'asset_initiation',
          method: 'POST',
          path: `/api/v1/content/${syntheticContentId}/assets`,
        },
        {
          body: JSON.stringify({ sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
          headers: { 'content-type': 'application/json' },
          label: 'asset_completion',
          method: 'POST',
          path: `/api/v1/content/${syntheticContentId}/assets/${syntheticAssetId}/complete`,
        },
        {
          body: JSON.stringify({
            body: '# Synthetic boundary check',
            bodyFormat: 'markdown',
          }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'synthetic-boundary',
            'if-match': '"none"',
          },
          label: 'version_creation',
          method: 'POST',
          path: `/api/v1/content/${syntheticContentId}/versions`,
        },
        {
          body: JSON.stringify({ destination: 'intranet' }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'synthetic-boundary',
            'if-match': `"${syntheticContentId}"`,
          },
          label: 'internal_publication',
          method: 'POST',
          path: `/api/v1/content/${syntheticContentId}/publish`,
        },
      ];

      return Promise.all(
        requests.map(async (request) => {
          try {
            const response = await fetch(`${apiOrigin}${request.path}`, {
              ...(request.body ? { body: request.body } : {}),
              headers: { ...commonHeaders, ...request.headers },
              method: request.method ?? 'GET',
            });
            const text = await response.text();
            let errorCode;
            let requestIdPresent = false;
            if (text.length <= 100_000) {
              try {
                const payload = JSON.parse(text);
                errorCode =
                  payload?.error && typeof payload.error.code === 'string'
                    ? payload.error.code
                    : undefined;
                requestIdPresent = typeof payload?.requestId === 'string';
              } catch {
                errorCode = undefined;
              }
            }
            return {
              errorCode,
              label: request.label,
              network: true,
              requestIdPresent,
              status: response.status,
            };
          } catch {
            return { label: request.label, network: false };
          }
        }),
      );
    },
    { assetId, contentId, origin },
  );
  const gatewayRequestWrapper = await worker.evaluate(async (apiOrigin) => {
    const request = fetch;
    const holder = { request: (input, init) => request(input, init) };
    try {
      const response = await holder.request(`${apiOrigin}/api/v1/content/collections?shape=flat`, {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer synthetic-invalid-token',
          'cache-control': 'no-store',
        },
      });
      return { network: true, status: response.status };
    } catch {
      return { network: false };
    }
  }, origin);

  const failures = checks.filter(
    (check) =>
      !check.network ||
      check.status !== 401 ||
      check.errorCode !== 'INVALID_TOKEN' ||
      !check.requestIdPresent,
  );
  if (failures.length > 0) {
    throw new Error(
      `Atrium extension-worker content boundary failed: ${failures
        .map(
          (failure) =>
            `${failure.label}:${
              failure.network
                ? `http_${failure.status}_${failure.errorCode ?? 'invalid'}`
                : 'network'
            }`,
        )
        .join(',')}`,
    );
  }
  if (!gatewayRequestWrapper.network || gatewayRequestWrapper.status !== 401) {
    throw new Error('Atrium gateway request wrapper failed in the extension worker.');
  }

  console.log(
    JSON.stringify({
      boundary: 'extension_worker_content_routes',
      checked: checks.map(({ label }) => label),
      gatewayRequestWrapper,
      status: 'pass',
      syntheticTokenRejected: true,
    }),
  );
} finally {
  await context?.close();
  await rm(userDataDirectory, { force: true, recursive: true });
}

async function extensionWorker(browserContext) {
  const existing = browserContext
    .serviceWorkers()
    .find((candidate) => candidate.url().startsWith(`chrome-extension://${extensionId}/`));
  return existing ?? browserContext.waitForEvent('serviceworker');
}
