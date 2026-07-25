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
  type TestInfo,
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

// Playwright requires an object-destructured fixture argument before TestInfo.
// eslint-disable-next-line no-empty-pattern
test('records a multi-page workflow across a forced service-worker stop', async ({}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.setViewportSize({ height: 900, width: 420 });
  await extensionWorker(context);
  await verifyResponsiveLayout(panel, testInfo, 'empty');
  const page = await context.newPage();
  await page.goto(`${fixtureOrigin}/index.html`);
  await page.bringToFront();
  await panel.getByRole('button', { name: 'Start recording' }).focus();
  await expect(panel.getByRole('button', { name: 'Start recording' })).toBeFocused();
  await panel.getByRole('button', { name: 'Start recording' }).click();
  await expect.poll(async () => (await snapshot(panel))?.state).toBe('recording');

  const beforeUntrustedSubmit = (await snapshot(panel))?.steps.length ?? 0;
  await page.locator('form').evaluate((form) => {
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page).toHaveURL(`${fixtureOrigin}/index.html`);
  await expect
    .poll(async () => (await snapshot(panel))?.steps.length ?? 0)
    .toBe(beforeUntrustedSubmit);

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

  await panel.reload();
  await expect
    .poll(async () => (await snapshot(panel))?.steps.length ?? 0, { timeout: 30_000 })
    .toBe(recoveredIds.length);
  await expect.poll(async () => (await snapshot(panel))?.state).toBe('recording');
  await expectNoHorizontalOverflow(panel);

  await panel.getByRole('button', { name: 'Stop and review' }).click();

  await expect(panel.getByRole('status')).toContainText('Ready for review');
  await verifyResponsiveLayout(panel, testInfo, 'review');
  const finalSnapshot = await snapshot(panel);
  const finalIds = finalSnapshot?.steps.map((step) => step.stepId) ?? [];
  expect(new Set(finalIds).size).toBe(finalIds.length);
  for (const stepId of acknowledgedStepIds) {
    expect(finalIds.filter((candidate) => candidate === stepId)).toHaveLength(1);
  }
  const instructions = finalSnapshot?.steps.map((step) => step.instruction.generatedText) ?? [];
  expect(instructions).toContain('Choose an option in Synthetic destination.');
  expect(instructions).toContain('Submit the form.');
  expect(instructions).toContain('Use the Ctrl+K keyboard shortcut.');
  expect(instructions).not.toContain('Use the Ctrl+Control keyboard shortcut.');
  expect(instructions.every((instruction) => instruction.length <= 250)).toBe(true);
  expect(instructions.join(' ')).not.toContain('Test-only password');
  await expect(panel.locator('ol > li')).toHaveCount(finalIds.length);
  await expect(
    panel.getByText('Typed values are omitted. Password fields are never captured.'),
  ).toBeVisible();

  const guideTitle = panel.getByLabel('Guide title');
  await guideTitle.fill('Synthetic renamed browser guide');
  await panel.locator('.title-editor').getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(panel))?.title)
    .toBe('Synthetic renamed browser guide');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await panel.reload();
  await expect(panel.getByLabel('Guide title')).toHaveValue('Synthetic renamed browser guide');

  const flaggedSteps = panel.locator('.step-select').filter({ hasText: 'redaction required' });
  await expect(flaggedSteps.first()).toBeVisible();
  await flaggedSteps.first().click();
  const zoom = panel.getByLabel('Screenshot zoom');
  await expect(zoom).toBeVisible();
  await zoom.fill('1.5');
  await expect(zoom).toHaveValue('1.5');
  for (const tool of ['Crop', 'Arrow', 'Rectangle', 'Text', 'Highlight', 'Mosaic', 'Redact']) {
    await expect(panel.getByRole('button', { name: tool, exact: true })).toBeVisible();
  }
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
  expect(publishable?.assets.some((asset) => asset.state === 'publishable_local')).toBe(true);
  expect(publishable?.assets.filter((asset) => asset.state === 'raw_local')).toHaveLength(0);
  await expect(panel.getByRole('status')).toContainText('Privacy approved');
  await expect(panel.getByText('raw source bytes were deleted', { exact: false })).toBeVisible();
  await expect(
    panel.getByText(
      'Your reviewed images are ready. Sign in to AI Studio to create a private Atrium draft.',
    ),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Sign in to AI Studio' })).toBeVisible();
  await verifyResponsiveLayout(panel, testInfo, 'publishable');

  await panel.getByText('Support diagnostics').click();
  await expect(
    panel.getByText('never screenshots, instructions, page URLs, typed values, or tokens', {
      exact: false,
    }),
  ).toBeVisible();
  const downloadPromise = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export safe diagnostics' }).click();
  const download = await downloadPromise;
  const diagnosticsPath = await download.path();
  if (!diagnosticsPath) {
    throw new Error('diagnostics_download_missing');
  }
  const diagnostics = await readFile(diagnosticsPath, 'utf8');
  expect(diagnostics).not.toContain('SYNTHETIC_LITERAL_MUST_NOT_PERSIST');
  expect(diagnostics).not.toContain('SYNTHETIC_PASSWORD_MUST_NOT_PERSIST');
  expect(diagnostics).not.toContain(fixtureOrigin);
  expect(diagnostics).not.toMatch(/access[_-]?token|refresh[_-]?token|bearer/i);

  await panel.getByText('Why these permissions?').click();
  await expect(
    panel.getByText('bounded action metadata only during a recording', { exact: false }),
  ).toBeVisible();

  panel.once('dialog', (dialog) => dialog.accept());
  await panel.getByRole('button', { name: 'Delete all local capture data' }).click();
  await expect(panel.getByRole('button', { name: 'Start recording' })).toBeVisible();
  await expect(panel.locator('ol > li')).toHaveCount(0);
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
          document.body.scrollWidth <= document.body.clientWidth,
      ),
    )
    .toBe(true);
}

async function expectNoClippedControls(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        return [...document.querySelectorAll('button, input, select, textarea, a')].every(
          (element) => {
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
              return true;
            }
            return rect.left >= -0.5 && rect.right <= viewportWidth + 0.5;
          },
        );
      }),
    )
    .toBe(true);
}

async function verifyResponsiveLayout(
  page: Page,
  testInfo: TestInfo,
  state: 'empty' | 'review' | 'publishable',
): Promise<void> {
  for (const width of [320, 360, 420]) {
    await page.setViewportSize({ height: 900, width });
    await expectNoHorizontalOverflow(page);
    await expectNoClippedControls(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`sidepanel-${state}-${width}.png`),
    });
  }
  await page.setViewportSize({ height: 900, width: 420 });
}

interface RecorderSnapshot {
  assets: Array<{ state: string }>;
  state: string;
  steps: Array<{ instruction: { generatedText: string }; stepId: string }>;
  title: string;
}
