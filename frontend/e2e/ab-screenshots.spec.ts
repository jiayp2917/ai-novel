// A/B 截图：4 视图（首页/写作/AI 工作台/设置）× 3 主题（breeze/stargold/silk）× solid/ai 模式 = 24 张对照图。
// 产出位置：runtime/ab-screenshots/phase1/<view>/<theme>-<mode>.png
// 配套：docs/ab-evaluation-checklist.md §"Phase 1 末必须出 …24 张对照"。
//
// 评分（4 维：可读性/一致性/情绪/噪点）不在本 spec 内——截图产出后由人按 checklist 看图打分。
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const apiBaseUrl = 'http://127.0.0.1:18080';
const sandboxPath = path.resolve(process.cwd(), '..', 'runtime', 'sandbox_workspace');
const outDir = path.resolve(process.cwd(), '..', 'runtime', 'ab-screenshots', 'phase1');

const THEMES = ['breeze', 'stargold', 'silk'] as const;
const MODES = ['ai', 'solid'] as const;

test('A/B 截图：4 视图 × 3 主题 × solid/ai = 24 张', { tag: '@screenshots' }, async ({ page }) => {
  test.setTimeout(360_000);
  fs.mkdirSync(outDir, { recursive: true });

  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  for (const theme of THEMES) {
    for (const mode of MODES) {
      await applyThemeAndMode(page, theme, mode);

      await capture(page, 'home', async () => {
        await mainNav(page, '首页').click();
        await expect(page.locator('.dashboard-intro')).toBeVisible();
      });

      await capture(page, 'writing', async () => {
        await mainNav(page, '写作').click();
        await openChapter(page, '001');
        await expect(page.locator('.reader-panel')).toBeVisible();
      });

      await capture(page, 'ai-workbench', async () => {
        await mainNav(page, 'AI 工作台').click();
        await openChapter(page, '001');
        await expect(page.locator('.ai-workbench-layout')).toBeVisible();
      });

      await capture(page, 'settings', async () => {
        await settingsEntry(page).click();
        await expect(page.locator('.settings-workspace-card--full')).toBeVisible();
      });
    }
  }
});

async function applyThemeAndMode(page: Page, theme: string, mode: string) {
  await page.evaluate(({ theme, mode }) => {
    window.localStorage.setItem('novel-editor-theme', theme);
    window.localStorage.setItem('workbench.assetMode', mode);
  }, { theme, mode });
  await page.goto('/');
  // assetMode 模块在加载时读 localStorage；reload 后已生效，这里再显式 set 一次做保险。
  await page.evaluate((mode) => {
    document.documentElement.setAttribute('data-asset-mode', mode);
  }, mode);
  await page.waitForLoadState('networkidle');
  // 主题 jpg 较大（2-3MB），给图层加载留时间。
  await page.waitForTimeout(900);
}

async function capture(page: Page, view: string, navigate: () => Promise<void>) {
  const dir = path.join(outDir, view);
  fs.mkdirSync(dir, { recursive: true });
  const theme = await page.locator('html').getAttribute('data-theme');
  const mode = await page.locator('html').getAttribute('data-asset-mode');
  await navigate();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(dir, `${theme}-${mode}.png`) });
  console.log(`  → ${view}/${theme}-${mode}.png`);
}

async function switchWorkspace(page: Page) {
  await openSettings(page);
  const workspaceCard = page.locator('.workspace-card').first();
  await expect(workspaceCard.getByRole('heading', { name: '作品列表与最近打开' })).toBeVisible();
  await workspaceCard.getByLabel('当前路径').fill(sandboxPath);
  await workspaceCard.getByRole('button', { name: '打开并扫描' }).click();
  const feedback = workspaceCard.locator('.workspace-feedback');
  const failed = await feedback.textContent().then((text) => text?.includes('打开失败')).catch(() => false);
  if (failed) {
    const reset = await page.request.post(`${apiBaseUrl}/api/test/reset-sandbox-workspace`);
    expect(reset.ok()).toBeTruthy();
    await workspaceCard.getByLabel('当前路径').fill(sandboxPath);
    await workspaceCard.getByRole('button', { name: '打开并扫描' }).click();
  }
  await expect(feedback).toContainText('已打开作品');
}

function settingsEntry(page: Page) {
  return page.getByRole('button', { name: '打开设置' });
}

async function openSettings(page: Page) {
  await settingsEntry(page).click();
}

function mainNav(page: Page, name: string) {
  return page.locator('.nav button').filter({ hasText: name });
}

async function openChapter(page: Page, paddedNo: string) {
  const row = page.locator('.chapter-row').filter({ hasText: paddedNo });
  await expect(row).toHaveCount(1);
  await row.click();
}
