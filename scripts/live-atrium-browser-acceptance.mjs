import { createRequire } from 'node:module';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/browser-extension/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionId = 'jldnpmcpimhabiphcglkbgmbffpoocpo';
const extensionPath = path.join(repositoryRoot, 'apps/browser-extension/.output/chrome-mv3');
const fixturePath = path.join(repositoryRoot, 'packages/test-fixtures/site');
const browserPath = process.env.ATRIUM_CAPTURE_ACCEPTANCE_BROWSER_PATH;
const publishInternal = process.env.ATRIUM_CAPTURE_ACCEPTANCE_PUBLISH_INTERNAL === '1';
const userDataDirectory = await mkdtemp(path.join(tmpdir(), 'atrium-capture-live-browser-'));

let context;
let server;

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
    ],
    serviceWorkers: 'allow',
  });

  const panel = context.pages()[0] ?? (await context.newPage());
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.setViewportSize({ height: 900, width: 420 });
  await extensionWorker(context);

  const fixturePage = await context.newPage();
  await fixturePage.goto(`${fixture.origin}/index.html`);
  await fixturePage.bringToFront();
  await panel.getByRole('button', { name: 'Start recording' }).click();
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

  const publishable = await snapshot(panel);
  if (publishable?.assets.some((asset) => asset.state === 'raw_local')) {
    throw new Error('raw_asset_remained_after_flatten');
  }
  if (!publishable?.assets.some((asset) => asset.state === 'publishable_local')) {
    throw new Error('publishable_derivative_missing');
  }

  const signIn = panel.getByRole('button', { name: 'Sign in to AI Studio' });
  await expect(signIn).toBeVisible();
  console.log(
    'Atrium Capture is ready. Complete the visible AI Studio district login; no client configuration or consent screen is expected.',
  );
  await signIn.click();
  const connected = panel.getByText('Connected to Atrium', { exact: true });
  const failedSignIn = panel.locator('p.error[role="alert"]');
  await Promise.race([
    connected.waitFor({ state: 'visible', timeout: 10 * 60_000 }),
    failedSignIn.waitFor({ state: 'visible', timeout: 10 * 60_000 }).then(async () => {
      const message = (await failedSignIn.textContent()) ?? '';
      const supportCode = message.match(/OAUTH-[A-Z-]+/)?.[0] ?? 'OAUTH-CANCELLED';
      return Promise.reject(new Error(`browser_identity_flow_failed:${supportCode}`));
    }),
  ]);

  await panel.getByRole('button', { name: 'Save private Atrium draft' }).click();
  await expect(panel.getByText('Private draft ready', { exact: true })).toBeVisible({
    timeout: 2 * 60_000,
  });
  await expect(panel.getByRole('link', { name: 'Open Atrium reader' })).toBeVisible();

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
      readerLink: 'present',
      status: 'pass',
    }),
  );
} finally {
  await context?.close();
  await closeServer(server);
  await rm(userDataDirectory, { force: true, recursive: true });
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

function assertAbsent(value, forbidden, label) {
  if (value.includes(forbidden)) {
    throw new Error(`${label.replaceAll(' ', '_')}_persisted`);
  }
}
