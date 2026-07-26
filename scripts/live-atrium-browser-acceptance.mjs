import { createRequire } from 'node:module';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/browser-extension/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionId = 'eomlblaiglafndhplfhilmdcaofhkkbj';
const extensionPath = path.join(repositoryRoot, 'apps/browser-extension/.output/chrome-mv3');
const fixturePath = path.join(repositoryRoot, 'packages/test-fixtures/site');
const browserPath = process.env.ATRIUM_CAPTURE_ACCEPTANCE_BROWSER_PATH;
const publishInternal = process.env.ATRIUM_CAPTURE_ACCEPTANCE_PUBLISH_INTERNAL === '1';
const configuredUserDataDirectory = process.env.ATRIUM_CAPTURE_ACCEPTANCE_PROFILE_DIR;
const forceNewGuide = process.env.ATRIUM_CAPTURE_ACCEPTANCE_FORCE_NEW_GUIDE === '1';
const userDataDirectory = configuredUserDataDirectory
  ? path.resolve(configuredUserDataDirectory)
  : await mkdtemp(path.join(tmpdir(), 'atrium-capture-live-browser-'));
if (configuredUserDataDirectory) {
  await mkdir(userDataDirectory, { mode: 0o700, recursive: true });
}

let context;
let server;
let acceptancePassed = false;
const atriumNetworkFailures = [];
const atriumHttpErrors = [];
const atriumCreateRequests = [];
const storageRequests = [];
const storageHttpErrors = [];

try {
  if (browserPath) {
    await access(browserPath);
  }
  await access(path.join(extensionPath, 'manifest.json'));
  const fixture = await startFixtureServer();
  server = fixture.server;

  context = await chromium.launchPersistentContext(userDataDirectory, {
    ...(browserPath ? { executablePath: browserPath } : { channel: 'chromium' }),
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-default-browser-check',
      '--no-first-run',
      '--profile-directory=Default',
    ],
    serviceWorkers: 'allow',
  });
  context.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'https://aistudio.psd401.ai') {
      return;
    }
    const errorText = request.failure()?.errorText ?? 'net::ERR_FAILED';
    atriumNetworkFailures.push({
      error: /^net::[A-Z0-9_]{1,100}$/.test(errorText) ? errorText : 'net::ERR_FAILED',
      method: request.method(),
      path: sanitizeAtriumPath(url.pathname),
    });
  });
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname.endsWith('.amazonaws.com') && request.method() === 'PUT') {
      storageRequests.push({
        headerNames: Object.keys(request.headers())
          .filter((name) => name.toLowerCase() !== 'authorization')
          .map((name) => name.toLowerCase())
          .sort(),
        queryNames: [...url.searchParams.keys()]
          .map((name) => name.toLowerCase())
          .filter((name) => /^[a-z0-9-]{1,100}$/.test(name))
          .sort(),
        signedHeaders: (url.searchParams.get('X-Amz-SignedHeaders') ?? '')
          .split(';')
          .filter((name) => /^[a-z0-9-]{1,100}$/.test(name))
          .sort(),
      });
      return;
    }
    if (
      url.origin !== 'https://aistudio.psd401.ai' ||
      url.pathname !== '/api/v1/content' ||
      request.method() !== 'POST'
    ) {
      return;
    }
    const postData = request.postData() ?? '';
    let parsed;
    try {
      parsed = JSON.parse(postData);
    } catch {
      parsed = undefined;
    }
    const sourceOrigins = Array.isArray(parsed?.sourceRef?.sourceOrigins)
      ? parsed.sourceRef.sourceOrigins
      : [];
    atriumCreateRequests.push({
      bodyBytes: new TextEncoder().encode(postData).byteLength,
      bodyKeys:
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.keys(parsed).sort()
          : [],
      localSourceOriginPresent: sourceOrigins.some((origin) => {
        try {
          const hostname = new URL(origin).hostname.toLowerCase();
          return (
            hostname === 'localhost' ||
            hostname.endsWith('.localhost') ||
            hostname === '127.0.0.1' ||
            hostname === '[::1]'
          );
        } catch {
          return true;
        }
      }),
      sourceOriginCount: sourceOrigins.length,
    });
  });
  context.on('response', async (response) => {
    const url = new URL(response.url());
    if (
      url.hostname.endsWith('.amazonaws.com') &&
      response.request().method() === 'PUT' &&
      response.status() >= 400
    ) {
      const diagnostic = { status: response.status() };
      storageHttpErrors.push(diagnostic);
      try {
        const text = await response.text();
        diagnostic.bodyBytes = new TextEncoder().encode(text).byteLength;
        diagnostic.signatureMismatch = /SignatureDoesNotMatch/i.test(text);
        diagnostic.accessDenied = /<Code>AccessDenied<\/Code>/i.test(text);
      } catch {
        // The bounded status remains sufficient diagnostics.
      }
      return;
    }
    if (url.origin !== 'https://aistudio.psd401.ai' || response.status() < 400) {
      return;
    }
    const headers = response.headers();
    const contentType = headers['content-type']?.slice(0, 100);
    const requestId = headers['x-request-id'];
    const diagnostic = {
      method: response.request().method(),
      path: sanitizeAtriumPath(url.pathname),
      status: response.status(),
      ...(contentType && /^[A-Za-z0-9+./; =_-]{1,100}$/.test(contentType) ? { contentType } : {}),
      ...(requestId && /^[A-Za-z0-9._:-]{1,200}$/.test(requestId) ? { requestId } : {}),
      server:
        headers.server && /^[A-Za-z0-9+./; =_-]{1,100}$/.test(headers.server)
          ? headers.server
          : undefined,
    };
    atriumHttpErrors.push(diagnostic);
    try {
      const text = await response.text();
      diagnostic.bodyBytes = new TextEncoder().encode(text).byteLength;
      diagnostic.genericForbidden =
        response.status() === 403 && /403 Forbidden|Request blocked/i.test(text);
    } catch {
      // The status, headers, and request path remain sufficient diagnostics.
    }
  });

  const panel = context.pages()[0] ?? (await context.newPage());
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.setViewportSize({ height: 900, width: 420 });
  await extensionWorker(context);

  let publishable = await snapshot(panel);
  if (publishable?.state !== 'publishable' || forceNewGuide) {
    const fixturePage = await context.newPage();
    await fixturePage.goto(`${fixture.origin}/index.html`);
    await fixturePage.bringToFront();
    if (publishable && forceNewGuide) {
      await panel.getByRole('button', { name: 'New guide' }).click();
    } else if (publishable?.state !== 'recording') {
      await panel.getByRole('button', { name: 'Start recording' }).click();
    }
    await expect.poll(async () => (await snapshot(panel))?.state).toBe('recording');

    await fixturePage.locator('#begin-request').click();
    await fixturePage.locator('#request-label').fill('SYNTHETIC_LITERAL_MUST_NOT_PERSIST');
    await fixturePage.locator('#request-label').blur();
    await fixturePage.locator('#fixture-password').fill('SYNTHETIC_PASSWORD_MUST_NOT_PERSIST');
    await fixturePage.locator('#fixture-password').blur();
    await fixturePage.locator('#destination').selectOption('south');
    await fixturePage.locator('#submit-request').click();
    await fixturePage.waitForURL(`${fixture.origin}/complete.html**`);

    await expect
      .poll(async () => (await snapshot(panel))?.steps.length ?? 0, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(5);
    const recorded = await snapshot(panel);
    const recordedJson = JSON.stringify(recorded);
    assertAbsent(recordedJson, 'SYNTHETIC_LITERAL_MUST_NOT_PERSIST', 'ordinary typed value');
    assertAbsent(recordedJson, 'SYNTHETIC_PASSWORD_MUST_NOT_PERSIST', 'password value');

    await panel.bringToFront();
    await panel.getByRole('button', { name: 'Stop and review' }).click();
    await expect(panel.getByText('Ready for review', { exact: true })).toBeVisible();

    const flaggedSteps = panel.locator('.step-select').filter({ hasText: 'redaction required' });
    for (let remaining = await flaggedSteps.count(); remaining > 0; remaining -= 1) {
      await flaggedSteps.first().click();
      await panel.getByRole('button', { name: 'Add suggested redaction' }).click();
      const approveStep = panel.getByRole('button', { name: 'Approve this step' });
      await expect(approveStep).toBeEnabled();
      await approveStep.click();
      await expect.poll(async () => flaggedSteps.count()).toBe(remaining - 1);
    }
    await panel.getByRole('button', { name: 'Approve all clear steps' }).click();
    const prepare = panel.getByRole('button', { name: 'Prepare publishable images' });
    await expect(prepare).toBeEnabled({ timeout: 30_000 });
    await prepare.click();
    await expect
      .poll(async () => (await snapshot(panel))?.state, { timeout: 30_000 })
      .toBe('publishable');
    publishable = await snapshot(panel);
  }
  if (publishable?.title !== 'Atrium Capture synthetic fixture') {
    throw new Error('retained_profile_not_synthetic');
  }
  const publishableJson = JSON.stringify(publishable);
  assertAbsent(publishableJson, 'SYNTHETIC_LITERAL_MUST_NOT_PERSIST', 'ordinary typed value');
  assertAbsent(publishableJson, 'SYNTHETIC_PASSWORD_MUST_NOT_PERSIST', 'password value');
  if (publishable?.assets.some((asset) => asset.state === 'raw_local')) {
    throw new Error('raw_asset_remained_after_flatten');
  }
  if (!publishable?.assets.some((asset) => asset.state === 'publishable_local')) {
    throw new Error('publishable_derivative_missing');
  }

  let beforePublish = await publisherSnapshot(panel);
  let existingJob = beforePublish?.job;
  if (beforePublish?.authentication !== 'signed_in') {
    const signIn = panel.getByRole('button', { name: 'Sign in to AI Studio' });
    await expect(signIn).toBeVisible();
    console.log(
      'Atrium Capture is ready. Complete the visible AI Studio district login; no client configuration or consent screen is expected.',
    );
    await signIn.click();
    try {
      await expect
        .poll(async () => (await publisherSnapshot(panel))?.authentication, {
          timeout: 10 * 60_000,
        })
        .toBe('signed_in');
    } catch {
      const message = (await panel.locator('p.error[role="alert"]').textContent()) ?? '';
      const supportCode = message.match(/OAUTH-[A-Z-]+/)?.[0] ?? 'OAUTH-CANCELLED';
      throw new Error(`browser_identity_flow_failed:${supportCode}`);
    }
    beforePublish = await publisherSnapshot(panel);
    existingJob = beforePublish?.job;
  }
  console.log(
    JSON.stringify({
      authentication: beforePublish?.authentication ?? 'unknown',
      checkpoint: 'before_private_draft',
      hasError: Boolean(existingJob?.lastError),
      phase: safeJobPhase(existingJob?.phase),
      readerLink: typeof existingJob?.readerUrl === 'string' ? 'present' : 'absent',
      retryable: existingJob?.lastError?.retryable === true,
    }),
  );

  if (existingJob && existingJob.phase !== 'ready_as_draft' && existingJob.phase !== 'complete') {
    await expect(panel.getByRole('button', { name: /^(Retry safely|Try again)$/ })).toBeVisible();
    const retryResult = await publisherCommand(panel, 'publisher.retry', {
      jobId: existingJob.jobId,
    });
    throwIfPublicationCommandFailed(retryResult, 'retry');
  } else if (!existingJob) {
    await panel.getByRole('button', { name: 'Save private Atrium draft' }).click();
  }
  await waitForPrivateDraft(
    panel,
    existingJob,
    atriumNetworkFailures,
    atriumHttpErrors,
    atriumCreateRequests,
    storageRequests,
    storageHttpErrors,
  );
  await expect(panel.getByRole('link', { name: 'Open Atrium draft' })).toBeVisible();
  const readerLink = panel.getByRole('link', { name: 'Open Atrium draft' });
  const readerHref = await readerLink.getAttribute('href');
  if (!readerHref) {
    throw new Error('browser_private_draft_reader_url_missing');
  }
  const readerURL = new URL(readerHref);
  if (
    readerURL.origin !== 'https://aistudio.psd401.ai' ||
    !/^\/atrium\/[0-9a-f-]{36}\/edit$/i.test(readerURL.pathname)
  ) {
    throw new Error('browser_private_draft_editor_url_invalid');
  }
  const readerPage = await context.newPage();
  await readerPage.goto(readerURL.toString(), { waitUntil: 'domcontentloaded' });
  await expect(
    readerPage.getByRole('heading', { name: publishable.title, exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  const readerBody = readerPage.locator('.atrium-content').first();
  await expect(readerBody).toBeVisible();
  const expectedAssetCount = publishable.steps.filter((step) => step.screenshotAssetId).length;
  await expect
    .poll(async () => readerBody.locator('img[data-atrium-asset-id]').count(), { timeout: 30_000 })
    .toBe(expectedAssetCount);
  await expect
    .poll(async () =>
      readerBody
        .locator('img[data-atrium-asset-id]')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0 &&
              image.naturalHeight > 0,
          ),
        ),
    )
    .toBe(true);
  for (const step of publishable.steps) {
    const instruction = step.instruction.editedText ?? step.instruction.generatedText;
    await expect(readerBody.getByText(instruction, { exact: true }).first()).toBeVisible();
  }
  await readerPage.close();

  let publication = 'private_draft';
  if (publishInternal) {
    await panel.getByRole('button', { name: 'Publish internally' }).click();
    await expect(panel.getByText('Published internally', { exact: true })).toBeVisible({
      timeout: 2 * 60_000,
    });
    publication = 'internal';
  }

  console.log(
    JSON.stringify({
      authentication: 'district_login',
      browser: browserPath ? path.basename(browserPath) : 'playwright-chromium',
      fixture: 'synthetic',
      publication,
      readerAssets: expectedAssetCount,
      readerLink: 'present',
      status: 'pass',
    }),
  );
  acceptancePassed = true;
} finally {
  await context?.close();
  await closeServer(server);
  if (!configuredUserDataDirectory || acceptancePassed) {
    await rm(userDataDirectory, { force: true, recursive: true });
  }
}

async function startFixtureServer() {
  const fixtureServer = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const filename = pathname === '/complete.html' ? 'complete.html' : 'index.html';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(await readFile(path.join(fixturePath, filename)));
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Synthetic fixture failed.');
    }
  });
  await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  const address = fixtureServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('fixture_server_address_missing');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    server: fixtureServer,
  };
}

async function closeServer(fixtureServer) {
  if (!fixtureServer) {
    return;
  }
  await new Promise((resolve, reject) =>
    fixtureServer.close((error) => (error ? reject(error) : resolve())),
  );
}

async function extensionWorker(browserContext) {
  const existing = browserContext
    .serviceWorkers()
    .find((candidate) => candidate.url().startsWith(`chrome-extension://${extensionId}/`));
  return existing ?? browserContext.waitForEvent('serviceworker');
}

async function snapshot(page) {
  return page.evaluate(
    async () =>
      new Promise((resolve, reject) => {
        const chromeRuntime = globalThis.chrome.runtime;
        chromeRuntime.sendMessage({ kind: 'recorder.snapshot' }, (response) => {
          if (chromeRuntime.lastError) {
            reject(new Error(chromeRuntime.lastError.message ?? 'runtime_message_failed'));
          } else {
            resolve(response);
          }
        });
      }),
  );
}

async function publisherSnapshot(page) {
  return page.evaluate(
    async () =>
      new Promise((resolve, reject) => {
        const chromeRuntime = globalThis.chrome.runtime;
        chromeRuntime.sendMessage({ kind: 'publisher.snapshot' }, (response) => {
          if (chromeRuntime.lastError) {
            reject(new Error(chromeRuntime.lastError.message ?? 'runtime_message_failed'));
          } else {
            resolve(response);
          }
        });
      }),
  );
}

async function publisherCommand(page, kind, payload) {
  return page.evaluate(
    async ({ messageKind, messagePayload }) =>
      new Promise((resolve, reject) => {
        const chromeRuntime = globalThis.chrome.runtime;
        chromeRuntime.sendMessage({ kind: messageKind, payload: messagePayload }, (response) => {
          if (chromeRuntime.lastError) {
            reject(new Error(chromeRuntime.lastError.message ?? 'runtime_message_failed'));
          } else {
            resolve(response);
          }
        });
      }),
    { messageKind: kind, messagePayload: payload },
  );
}

function throwIfPublicationCommandFailed(value, operation) {
  if (!value || typeof value !== 'object' || !('errorCode' in value)) {
    return;
  }
  const rawCode = value.errorCode;
  const code =
    typeof rawCode === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(rawCode)
      ? rawCode.toLowerCase()
      : 'publication_failed';
  const rawRequestId = value.requestId;
  const requestId =
    typeof rawRequestId === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(rawRequestId)
      ? rawRequestId
      : undefined;
  throw new Error(
    `browser_private_draft_${operation}_failed:${code}${
      requestId ? `:request_id=${requestId}` : ''
    }`,
  );
}

function assertAbsent(value, forbidden, label) {
  if (value.includes(forbidden)) {
    throw new Error(`${label.replaceAll(' ', '_')}_persisted`);
  }
}

function formatNetworkFailures(failures) {
  if (failures.length === 0) {
    return '';
  }
  return `:network=${failures
    .slice(-5)
    .map(({ error, method, path: requestPath }) => `${method}_${requestPath}_${error}`)
    .join(',')}`;
}

function safeJobPhase(value) {
  return typeof value === 'string' && /^[a-z_]{1,40}$/.test(value) ? value : 'unknown';
}

function sanitizeAtriumPath(value) {
  return value
    .slice(0, 500)
    .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{id}');
}

async function waitForPrivateDraft(
  page,
  baselineJob,
  networkFailures,
  httpErrors,
  createRequests,
  assetStorageRequests,
  assetStorageErrors,
) {
  const deadline =
    Date.now() + (typeof baselineJob?.contentObjectId === 'string' ? 2 * 60_000 : 45_000);
  let lastJob = baselineJob;
  while (Date.now() < deadline) {
    const current = (await publisherSnapshot(page))?.job;
    lastJob = current ?? lastJob;
    if (
      current &&
      (current.phase === 'ready_as_draft' || current.phase === 'complete') &&
      typeof current.readerUrl === 'string'
    ) {
      return;
    }
    const changed =
      current &&
      (!baselineJob ||
        current.updatedAt !== baselineJob.updatedAt ||
        current.attemptCount !== baselineJob.attemptCount ||
        current.phase !== baselineJob.phase);
    if (changed && current.lastError) {
      const rawCode = current.lastError.code;
      const code =
        typeof rawCode === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(rawCode)
          ? rawCode.toLowerCase()
          : 'publication_failed';
      const rawRequestId = current.lastError.requestId;
      const requestId =
        typeof rawRequestId === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(rawRequestId)
          ? rawRequestId
          : undefined;
      throw new Error(
        `browser_private_draft_job_failed:${code}:phase=${safeJobPhase(current.phase)}${
          requestId ? `:request_id=${requestId}` : ''
        }${formatNetworkFailures(networkFailures)}${formatHttpErrors(httpErrors)}${formatCreateRequests(
          createRequests,
        )}${formatStorageBoundary(assetStorageRequests, assetStorageErrors)}`,
      );
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `browser_private_draft_timed_out:phase=${safeJobPhase(lastJob?.phase)}:has_error=${Boolean(
      lastJob?.lastError,
    )}:attempts=${Number.isSafeInteger(lastJob?.attemptCount) ? lastJob.attemptCount : 'unknown'}${formatNetworkFailures(
      networkFailures,
    )}${formatHttpErrors(httpErrors)}${formatCreateRequests(createRequests)}${formatStorageBoundary(
      assetStorageRequests,
      assetStorageErrors,
    )}`,
  );
}

function formatHttpErrors(errors) {
  if (errors.length === 0) {
    return '';
  }
  return `:http=${errors
    .slice(-5)
    .map(
      ({
        bodyBytes,
        contentType,
        genericForbidden,
        method,
        path: requestPath,
        requestId,
        server,
        status,
      }) =>
        `${method}_${requestPath}_${status}${contentType ? `_${contentType.replaceAll(' ', '-')}` : ''}${
          requestId ? `_request-${requestId}` : ''
        }${server ? `_server-${server.replaceAll(' ', '-')}` : ''}${
          Number.isSafeInteger(bodyBytes) ? `_bytes-${bodyBytes}` : ''
        }${genericForbidden ? '_generic-forbidden' : ''}`,
    )
    .join(',')}`;
}

function formatCreateRequests(requests) {
  if (requests.length === 0) {
    return ':create_request=absent';
  }
  return `:create_request=${requests
    .slice(-3)
    .map(
      ({ bodyBytes, bodyKeys, localSourceOriginPresent, sourceOriginCount }) =>
        `bytes-${bodyBytes}_keys-${bodyKeys.join('+') || 'invalid'}_origins-${sourceOriginCount}_local-${localSourceOriginPresent}`,
    )
    .join(',')}`;
}

function formatStorageBoundary(requests, errors) {
  const request = requests.at(-1);
  const error = errors.at(-1);
  if (!request && !error) {
    return '';
  }
  return `:storage=${request ? `headers-${request.headerNames.join('+') || 'none'}_query-${request.queryNames.join('+') || 'none'}_signed-${request.signedHeaders.join('+') || 'none'}` : 'request-absent'}${
    error
      ? `_http-${error.status}${Number.isSafeInteger(error.bodyBytes) ? `_bytes-${error.bodyBytes}` : ''}${
          error.signatureMismatch ? '_signature-mismatch' : ''
        }${error.accessDenied ? '_access-denied' : ''}`
      : ''
  }`;
}
