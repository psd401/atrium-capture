import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';

const extensionId = 'jldnpmcpimhabiphcglkbgmbffpoocpo';
const extensionPath = path.resolve(import.meta.dirname, '../../.output/chrome-mv3');
const fixturePath = path.resolve(import.meta.dirname, '../../../../packages/test-fixtures/site');

let context: BrowserContext;
let server: Server;
let fixtureOrigin: string;
let userDataDirectory: string;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const filename = pathname === '/complete.html' ? 'complete.html' : 'index.html';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await readFile(path.join(fixturePath, filename)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fixture_server_address_missing');
  }
  fixtureOrigin = `http://127.0.0.1:${address.port}`;
  userDataDirectory = await mkdtemp(path.join(tmpdir(), 'atrium-capture-playwright-'));
  context = await chromium.launchPersistentContext(userDataDirectory, {
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    channel: 'chromium',
    headless: true,
    serviceWorkers: 'allow',
  });
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((resolve, reject) =>
    server?.close((error) => (error ? reject(error) : resolve())),
  );
  if (userDataDirectory) {
    await rm(userDataDirectory, { force: true, recursive: true });
  }
});

test('records a multi-page workflow across a forced service-worker stop', async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await extensionWorker(context);
  const page = await context.newPage();
  await page.goto(`${fixtureOrigin}/index.html`);
  await page.bringToFront();
  await panel.getByRole('button', { name: 'Start recording' }).click();
  await expect.poll(async () => (await snapshot(panel))?.state).toBe('recording');

  await page.locator('#begin-request').click();
  await page.locator('#request-label').fill('SYNTHETIC_LITERAL_MUST_NOT_PERSIST');
  await page.locator('#request-label').blur();
  await page.locator('#fixture-password').fill('SYNTHETIC_PASSWORD_MUST_NOT_PERSIST');
  await page.locator('#fixture-password').blur();
  await page.locator('#destination').selectOption('south');
  await page.locator('#request-label').press('Control+K');

  await expect
    .poll(async () => (await snapshot(panel))?.steps.length ?? 0, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(5);
  const beforeStop = await snapshot(panel);
  expect(beforeStop).toBeTruthy();
  expect(JSON.stringify(beforeStop)).not.toContain('SYNTHETIC_LITERAL_MUST_NOT_PERSIST');
  expect(JSON.stringify(beforeStop)).not.toContain('SYNTHETIC_PASSWORD_MUST_NOT_PERSIST');
  expect(beforeStop?.assets.length).toBeGreaterThan(0);
  const acknowledgedStepIds = beforeStop?.steps.map((step) => step.stepId) ?? [];

  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');

  await page.locator('#submit-request').click();
  await page.waitForURL(`${fixtureOrigin}/complete.html**`);
  await expect
    .poll(async () => (await snapshot(panel))?.steps.length ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(acknowledgedStepIds.length);

  const recovered = await snapshot(panel);
  const recoveredIds = recovered?.steps.map((step) => step.stepId) ?? [];
  expect(new Set(recoveredIds).size).toBe(recoveredIds.length);
  for (const stepId of acknowledgedStepIds) {
    expect(recoveredIds.filter((candidate) => candidate === stepId)).toHaveLength(1);
  }

  await panel.getByRole('button', { name: 'Stop and review' }).click();

  await expect(panel.getByRole('status')).toContainText('Ready for review');
  const finalSnapshot = await snapshot(panel);
  const finalIds = finalSnapshot?.steps.map((step) => step.stepId) ?? [];
  expect(new Set(finalIds).size).toBe(finalIds.length);
  for (const stepId of acknowledgedStepIds) {
    expect(finalIds.filter((candidate) => candidate === stepId)).toHaveLength(1);
  }
  await expect(panel.locator('ol > li')).toHaveCount(finalIds.length);
  await expect(
    panel.getByText('Typed values are omitted. Password fields are never captured.'),
  ).toBeVisible();
});

async function extensionWorker(browserContext: BrowserContext): Promise<Worker> {
  const existing = browserContext
    .serviceWorkers()
    .find((candidate) => candidate.url().startsWith(`chrome-extension://${extensionId}/`));
  return existing ?? browserContext.waitForEvent('serviceworker');
}

async function sendExtensionMessage(page: Page, message: unknown): Promise<unknown> {
  return page.evaluate(
    async (payload) =>
      new Promise((resolve, reject) => {
        const chromeRuntime = (
          globalThis as typeof globalThis & {
            chrome: {
              runtime: {
                lastError?: { message?: string };
                sendMessage: (value: unknown, callback: (response: unknown) => void) => void;
              };
            };
          }
        ).chrome.runtime;
        chromeRuntime.sendMessage(payload, (response) => {
          if (chromeRuntime.lastError) {
            reject(new Error(chromeRuntime.lastError.message ?? 'runtime_message_failed'));
          } else {
            resolve(response);
          }
        });
      }),
    message,
  );
}

async function snapshot(page: Page): Promise<RecorderSnapshot | undefined> {
  return (await sendExtensionMessage(page, { kind: 'recorder.snapshot' })) as
    RecorderSnapshot | undefined;
}

interface RecorderSnapshot {
  assets: unknown[];
  state: string;
  steps: Array<{ stepId: string }>;
}
