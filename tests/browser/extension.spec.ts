import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { reportSchema, type Report } from '../../packages/shared/src';

const mockedAnalysis = { summary: 'A selected set of five color blocks.', uxInsights: [{ id: 'grouping', title: 'Consistent grouping', finding: 'The blocks appear as one group.', evidence: 'Five equally sized blocks touch along a shared baseline.', principle: 'Proximity', impact: 'The arrangement suggests a common palette.', recommendation: null, classification: 'inferred', confidence: 'medium' }], productInsights: { featureName: 'Palette display', purpose: 'May support color comparison.', observedElements: ['Five color blocks'], observedStates: ['All five blocks are visible'], inferredBehaviors: [{ behavior: 'The colors may be intended for comparison.', evidence: 'Equal size and adjacent placement.', confidence: 'low' }], unknowns: ['Whether a block is interactive'], validationQuestions: ['Does selecting a color copy it?'] }, limitations: ['A single screenshot cannot establish interactions.'] };

function chromiumPath(): string | undefined {
  if (process.env.VCLARITY_CHROMIUM_PATH) return process.env.VCLARITY_CHROMIUM_PATH;
  const projectCache = resolve('.playwright');
  if (existsSync(projectCache)) {
    for (const entry of readdirSync(projectCache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
      const executable = join(projectCache, entry, 'chrome-win64', 'chrome.exe');
      if (existsSync(executable)) return executable;
    }
  }
  const local = process.env.LOCALAPPDATA;
  if (!local) return undefined;
  const cache = join(local, 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  for (const entry of readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
    const executable = join(cache, entry, 'chrome-win64', 'chrome.exe');
    if (existsSync(executable)) return executable;
  }
  return undefined;
}
interface ExtensionFixture { context: BrowserContext; page: Page; panel: Page; worker: Worker; tabId: number; id: string }
async function loadExtension(scale = 1, width = 1280): Promise<ExtensionFixture> {
  const extension = resolve('apps/extension/.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    headless: true, executablePath: chromiumPath(), channel: chromiumPath() ? undefined : 'chromium',
    viewport: { width, height: 1100 }, deviceScaleFactor: scale,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--enable-unsafe-extension-debugging'],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await expect(panel.getByTestId('panel')).toBeVisible();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.bringToFront();
  const tabId = await worker.evaluate(async () => { const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return tabs[0]!.id!; });
  await expect(panel.locator('.website')).toContainText('127.0.0.1');
  return { context, page, panel, worker, tabId, id };
}
async function grantActiveTab(fixture: ExtensionFixture): Promise<void> {
  const browserCdp = await fixture.context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const tab = targetInfos.find(target => target.url === fixture.page.url());
  if (!tab) throw new Error(`Missing browser tab target: ${JSON.stringify(targetInfos)}`);
  await browserCdp.send('Extensions.triggerAction', { id: fixture.id, targetId: tab.targetId });
  // Wait for the native panel to open before closing it, avoiding a close/open race.
  await expect.poll(async () => (await browserCdp.send('Target.getTargets')).targetInfos.filter(target => target.url === `chrome-extension://${fixture.id}/sidepanel.html`).length).toBe(2);
  await fixture.worker.evaluate(async () => { const window = await chrome.windows.getCurrent(); await chrome.sidePanel.close({ windowId: window.id! }); });
  await expect.poll(async () => (await browserCdp.send('Target.getTargets')).targetInfos.filter(target => target.url === `chrome-extension://${fixture.id}/sidepanel.html`).length).toBe(1);
  await fixture.page.bringToFront();
  await browserCdp.detach();
}
async function start(fixture: ExtensionFixture, mode: 'live' | 'ghost'): Promise<void> {
  await fixture.panel.getByTestId(mode === 'live' ? 'inspect-live' : 'inspect-ghost').click();
  await expect(fixture.page.locator('[data-vclarity-overlay]')).toHaveCount(1);
}
async function report(fixture: ExtensionFixture): Promise<Report | null> {
  const stored: unknown = await fixture.worker.evaluate(async tabId => (await chrome.storage.session.get(`report:${tabId}`))[`report:${tabId}`] ?? null, fixture.tabId);
  return stored === null ? null : reportSchema.parse(stored);
}
async function pick(fixture: ExtensionFixture, selector: string): Promise<void> {
  const box = await fixture.page.locator(selector).boundingBox();
  if (!box) throw new Error(`Missing fixture element: ${selector}`);
  await fixture.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await fixture.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(fixture.page.locator('[data-vclarity-overlay]')).toHaveCount(0);
}

test('production MV3 loads, real DOM values, Shadow DOM, transforms, iframe limits and cancellation', async () => {
  const fixture = await loadExtension();
  try {
    await start(fixture, 'live');
    await pick(fixture, '#known-button');
    await expect.poll(async () => (await report(fixture))?.status).toBe('element-selected');
    const actual = (await report(fixture))!.element!;
    expect(actual.rect.width).toBe(160); expect(actual.rect.height).toBe(48);
    expect(actual.typography['font-size']).toBe('16px'); expect(actual.typography['font-weight']).toBe('600');
    expect(actual.spacing['padding-top']).toBe('12px'); expect(actual.geometry['border-top-left-radius']).toBe('8px');
    expect(actual.appearance['background-color']).toBe('rgb(54, 92, 245)');
    expect(actual.source).toBe('Exact (DOM)');
    expect(await fixture.page.evaluate(() => (window as unknown as { fixtureClicks: number }).fixtureClicks)).toBe(0);
    await expect(fixture.panel.getByText('160px', { exact: true }).first()).toBeVisible();
    await fixture.panel.setViewportSize({ width: 380, height: 1000 });
    const badge = fixture.panel.locator('.badge.source-dom').first();
    await badge.focus();
    await expect(fixture.panel.getByRole('tooltip').first()).toBeVisible();
    await badge.press('Escape');
    await expect(fixture.panel.getByRole('tooltip').first()).toBeHidden();
    await fixture.panel.screenshot({ path: 'test-results/vclarity-live.png', fullPage: true });
    expect(await fixture.panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fixture.panel.setViewportSize({ width: 300, height: 900 });
    await fixture.panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(fixture.panel.getByLabel('Local service access token')).toBeFocused();
    expect(await fixture.panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fixture.panel.screenshot({ path: 'test-results/vclarity-settings.png', fullPage: true });
    await fixture.panel.getByRole('button', { name: 'Close settings' }).click();
    await start(fixture, 'live'); await pick(fixture, '#shadow-button');
    await expect.poll(async () => (await report(fixture))?.element?.selector).toContain('shadow-button');
    await start(fixture, 'live'); await pick(fixture, '#transformed');
    const transformed = (await report(fixture))!.element!;
    expect(transformed.rect.width).toBe(125); expect(transformed.geometry['css-width']).toBe('100px');
    await start(fixture, 'live'); await pick(fixture, 'iframe');
    expect((await report(fixture))!.element!.limitations.join(' ')).toContain('Frame internals');
    await start(fixture, 'live'); await fixture.page.keyboard.press('Escape');
    await expect(fixture.page.locator('[data-vclarity-overlay]')).toHaveCount(0);
    await expect.poll(async () => (await report(fixture))?.status).toBe('cancelled');
    await fixture.page.locator('#known-button').click();
    expect(await fixture.page.evaluate(() => (window as unknown as { fixtureClicks: number }).fixtureClicks)).toBe(1);
  } finally { await fixture.context.close(); }
});

for (const scale of [1, 2]) {
  test(`Ghost capture, pixel palette and worker at scale ${scale}`, async () => {
    const fixture = await loadExtension(scale, scale === 1 ? 1280 : 1050);
    try {
      // Headless CDP key injection does not dispatch Chrome extension shortcuts.
      // Exercise the same background workflow through the panel fallback control.
      await grantActiveTab(fixture);
      await fixture.panel.evaluate(() => {
        chrome.runtime.onMessage.addListener((message: { type?: string; dataUrl?: string; viewport?: { width: number; height: number }; region?: { x: number; y: number; width: number; height: number } }) => {
          if (message.type !== 'CAPTURE' || !message.dataUrl) return;
          const image = new Image();
          image.onload = () => { (window as unknown as { captureGeometry: unknown }).captureGeometry = { width: image.naturalWidth, height: image.naturalHeight, viewport: message.viewport, region: message.region }; };
          image.src = message.dataUrl;
        });
      });
      await start(fixture, 'ghost');
      const box = await fixture.page.locator('#palette').boundingBox();
      if (!box) throw new Error('Palette fixture is unavailable');
      await fixture.page.mouse.move(box.x + box.width - 1, box.y + box.height - 1);
      await fixture.page.mouse.down();
      await fixture.page.mouse.move(box.x + 1, box.y + 1, { steps: 8 });
      await fixture.page.mouse.up();
      await expect(fixture.page.locator('[data-vclarity-overlay]')).toHaveCount(0);
      await expect.poll(async () => { const state = await report(fixture); return { status: state?.status, error: state?.error }; }).toEqual({ status: 'local-ready', error: null });
      const ready = (await report(fixture))!;
      expect(ready.palette).toHaveLength(5);
      expect(ready.palette.map(color => color.hex).sort()).toEqual(['#000000', '#0000FF', '#00FF00', '#FF0000', '#FFFFFF']);
      for (const color of ready.palette) expect(color.coverage).toBeCloseTo(20, 0);
      await expect(fixture.panel.getByText('Measured (Pixels)', { exact: true }).first()).toBeVisible();
      await expect(fixture.panel.getByRole('img', { name: /captured|region/i })).toBeVisible();
      const captured = await fixture.panel.evaluate(() => (window as unknown as { captureGeometry: { width: number; height: number; viewport: { width: number; height: number }; region: { x: number; y: number; width: number; height: number } } }).captureGeometry);
      const sx = captured.width / captured.viewport.width, sy = captured.height / captured.viewport.height;
      const expectedWidth = Math.ceil((captured.region.x + captured.region.width) * sx) - Math.floor(captured.region.x * sx);
      const expectedHeight = Math.ceil((captured.region.y + captured.region.height) * sy) - Math.floor(captured.region.y * sy);
      await expect(fixture.panel.getByText(`Original ${expectedWidth} × ${expectedHeight} px`, { exact: false })).toBeVisible();
      await fixture.panel.setViewportSize({ width: 360, height: 1000 });
      await fixture.panel.screenshot({ path: `test-results/vclarity-ghost-${scale}.png`, fullPage: true });
      expect(await fixture.panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(ready.analysis).toBeNull();
      expect(JSON.stringify(await fixture.worker.evaluate(async () => chrome.storage.session.get(null)))).not.toContain('data:image');
      if (scale === 1) {
        const requests: Array<{ requestId: string; image: { dataUrl: string } }> = [];
        await fixture.panel.route('http://127.0.0.1:4317/analyze', async route => {
          const request = route.request().postDataJSON() as { requestId: string; image: { dataUrl: string } };
          requests.push(request);
          await route.fulfill({ status: requests.length === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(requests.length === 1 ? { error: { code: 'provider_unavailable', message: 'Test provider unavailable. Retry this image.' } } : { requestId: request.requestId, analysis: mockedAnalysis }) });
        });
        await fixture.panel.getByTestId('tab-insights').click();
        await expect(fixture.panel.getByRole('button', { name: 'Send image & analyze' })).toBeDisabled();
        expect(requests).toHaveLength(0);
        await fixture.panel.getByRole('button', { name: 'Settings', exact: true }).click();
        await fixture.panel.getByLabel('Local service access token').fill('test-service-access-token-for-browser-suite');
        await fixture.panel.getByRole('button', { name: 'Close settings' }).click();
        await fixture.panel.getByLabel('I allow this selected image to be sent for AI analysis.').check();
        await expect(fixture.panel.getByRole('button', { name: 'Send image & analyze' })).toBeEnabled();
        await fixture.panel.screenshot({ path: 'test-results/vclarity-consent.png', fullPage: true, animations: 'disabled' });
        expect(requests).toHaveLength(0);
        await fixture.panel.getByRole('button', { name: 'Send image & analyze' }).click();
        await expect.poll(async () => (await report(fixture))?.status).toBe('ai-error');
        await expect(fixture.panel.getByText('Retry this image', { exact: true })).toBeVisible();
        await fixture.panel.getByRole('button', { name: 'Send image & analyze' }).click();
        await expect.poll(async () => (await report(fixture))?.status).toBe('completed');
        expect(requests).toHaveLength(2);
        expect(requests[0]!.image.dataUrl).toBe(requests[1]!.image.dataUrl);
        expect(requests[0]!.requestId).not.toBe(requests[1]!.requestId);
        await expect(fixture.panel.getByRole('heading', { name: 'Consistent grouping' })).toBeVisible();
        await expect(fixture.panel.getByText('Inferred purpose', { exact: true })).toBeVisible();
        await expect(fixture.panel.getByText('Whether a block is interactive', { exact: true })).toBeVisible();
        await fixture.panel.screenshot({ path: 'test-results/vclarity-insights.png', fullPage: true });
        await fixture.panel.getByRole('button', { name: 'Copy full report', exact: true }).click();
        await expect(fixture.panel.getByRole('button', { name: 'Copy full report: copied' })).toBeVisible();
        await fixture.panel.getByTestId('tab-design').click();
        await fixture.panel.getByRole('button', { name: 'Copy color palette', exact: true }).click();
        await expect(fixture.panel.getByRole('button', { name: 'Copy color palette: copied' })).toBeVisible();
        await fixture.page.reload();
        await expect.poll(async () => await report(fixture)).toBeNull();
        await expect(fixture.panel.getByRole('img', { name: /captured|region/i })).toHaveCount(0);
      }
    } finally { await fixture.context.close(); }
  });
}
