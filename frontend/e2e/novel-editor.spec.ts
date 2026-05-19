import { expect, test, type Page } from '@playwright/test';

const sandboxPath = String.raw`D:\2917\numeric-monster\runtime\sandbox_workspace`;
const apiBaseUrl = 'http://127.0.0.1:18080';

test('new user can scan, read, annotate, reject unsafe publish, and publish sandbox chapter', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '首页工作台' })).toBeVisible();
  await expect(page.getByText('小说编辑器').first()).toBeVisible();

  await switchWorkspace(page);
  await expect(page.locator('.workspace-stats').getByText('源文件：4', { exact: true })).toBeVisible();
  await expect(page.locator('.workspace-stats').getByText('正文：2', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '正文编写' }).click();
  await openChapter(page, '001');
  await expect(page.locator('.reader-header h1')).toContainText('第1章：开局觉醒');
  await expect(page.locator('.reader-panel')).toBeVisible();

  await createManualAnnotation(page, '李燃站在队伍最后', '新手路径：确认开篇人物位置清晰。');
  await expect(page.locator('.annotation-card').filter({ hasText: '新手路径：确认开篇人物位置清晰。' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.annotation-card').filter({ hasText: '新手路径：确认开篇人物位置清晰。' })).toBeVisible();

  const themeBefore = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: themeBefore === 'dark' ? '浅色' : '深色' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', themeBefore === 'dark' ? 'light' : 'dark');

  const chapterOne = await chapterByNo(page, 1);
  const chapterTwo = await chapterByNo(page, 2);
  const chapterOneContent = await chapterContent(page, chapterOne.id);
  const mismatch = await seedCandidate(page, chapterOne.id, chapterOneContent.text);

  await page.getByRole('button', { name: '修复发布' }).click();
  await openChapter(page, '002');
  await page.getByPlaceholder('手动输入 artifact_id').fill(String(mismatch.artifact_id));
  await page.getByRole('button', { name: '绑定候选' }).click();
  await expect(page.getByText('候选不属于当前章节，不能在此处审核、查看差异或发布。')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看差异' })).toBeDisabled();

  await page.getByRole('button', { name: '设定/章纲' }).click();
  await page.locator('.source-row').filter({ hasText: '01-设定' }).click();
  const setting = await firstSource(page, 'settings');
  const settingContent = await sourceContent(page, setting.id);
  const proposal = await seedProposal(page, setting.id, `${settingContent.text}\n\n测试提案。`);
  await page.getByPlaceholder('手动输入 artifact_id').fill(String(proposal.artifact_id));
  await page.getByRole('button', { name: '绑定候选' }).click();
  await expect(page.getByRole('button', { name: '提案不直接发布' })).toBeDisabled();

  await page.getByRole('button', { name: '修复发布' }).click();
  await openChapter(page, '002');
  const beforePublish = await chapterContent(page, chapterTwo.id);
  const publishMarker = '\n\n发布门沙盒验证：正文只通过候选写回。';
  const publishSeed = await seedReviewedCandidate(page, chapterTwo.id, `${beforePublish.text}${publishMarker}`);
  await page.getByPlaceholder('手动输入 artifact_id').fill(String(publishSeed.artifact_id));
  await page.getByRole('button', { name: '绑定候选' }).click();
  await page.getByRole('button', { name: '查看差异' }).click();
  await expect(page.locator('.diff-preview')).toContainText('发布门沙盒验证');
  await page.getByRole('button', { name: '人工确认发布' }).click();
  await expect(page.getByText(`候选 #${publishSeed.artifact_id} 已通过发布门写回。`)).toBeVisible();

  const afterPublish = await chapterContent(page, chapterTwo.id);
  expect(afterPublish.text).toContain('发布门沙盒验证');
  const health = await page.request.get(`${apiBaseUrl}/health`).then((response) => response.json());
  expect(health.workspace.root).toBe(sandboxPath);
});

test('core views remain separated and writing layout does not use bottom overlays', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  for (const title of ['正文编写', '审核中心', '记忆库', '模型任务', '作品/工作区入口']) {
    await page.locator('.nav').getByRole('button', { name: title }).click();
    await expect(page.locator('.crumb')).toContainText(title);
  }

  await page.getByRole('button', { name: '正文编写' }).click();
  await openChapter(page, '001');
  const widthRatio = await page.evaluate(() => {
    const reader = document.querySelector('.reader-panel')?.getBoundingClientRect();
    if (!reader) return 0;
    return reader.width / window.innerWidth;
  });
  expect(widthRatio).toBeGreaterThan(0.5);
  await expect(page.locator('details.workflow-drawer')).toHaveCount(0);

  await page.getByRole('button', { name: '打开侧栏' }).click();
  await expect(page.locator('.annotations-panel')).toBeVisible();
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(page.locator('.editor-shell')).toHaveClass(/inspector-hidden/);
});

test('writing workspace supports tabs, search, fullscreen, filter, and safe context menu placement', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await page.getByRole('button', { name: '正文编写' }).click();
  await openChapter(page, '001');
  await openChapter(page, '002');
  await expect(page.locator('.chapter-tab')).toHaveCount(2);
  await expect(page.locator('.chapter-tab').filter({ hasText: '002' })).toHaveClass(/chapter-tab--active/);
  await page.locator('.chapter-tab').filter({ hasText: '001' }).click();
  await expect(page.locator('.reader-header h1')).toContainText('第1章');

  await page.getByPlaceholder('章号或标题').fill('002');
  await expect(page.locator('.chapter-row').filter({ hasText: '001' })).toHaveCount(0);
  await expect(page.locator('.chapter-row').filter({ hasText: '002' })).toHaveCount(1);
  await page.getByPlaceholder('章号或标题').fill('');

  const expandedRatio = await page.evaluate(() => {
    const content = document.querySelector('.cm-content')?.getBoundingClientRect();
    const reader = document.querySelector('.reader-panel')?.getBoundingClientRect();
    if (!content || !reader) return 0;
    return content.width / reader.width;
  });
  expect(expandedRatio).toBeGreaterThan(0.65);

  await page.getByPlaceholder('输入要查找的文字').fill('李燃');
  await expect(page.getByText('匹配')).toBeVisible();
  const searchMatches = await page.locator('.cm-search-match').count();
  expect(searchMatches).toBeGreaterThan(0);
  await expect(page.locator('.cm-search-match--active')).toHaveCount(1);
  const firstActiveTop = await activeSearchTop(page);
  await page.getByRole('button', { name: '下一处' }).click();
  await expect(page.locator('.cm-search-match--active')).toHaveCount(1);
  const secondActiveTop = await activeSearchTop(page);
  expect(secondActiveTop).not.toBe(firstActiveTop);

  await page.getByRole('button', { name: '隐藏目录' }).click();
  await expect(page.locator('.editor-shell')).toHaveClass(/catalog-hidden/);
  await page.getByRole('button', { name: '打开目录' }).click();
  await expect(page.locator('.editor-shell')).not.toHaveClass(/catalog-hidden/);

  await page.getByRole('button', { name: '全屏写作' }).click();
  await expect(page.getByRole('button', { name: '退出全屏' })).toBeVisible();
  await expect(page.locator('.editor-shell')).toHaveClass(/writing-fullscreen/);
  const fullscreenRatio = await page.evaluate(() => {
    const reader = document.querySelector('.reader-panel')?.getBoundingClientRect();
    if (!reader) return 0;
    return reader.width / window.innerWidth;
  });
  expect(fullscreenRatio).toBeGreaterThan(0.8);

  await page.mouse.click(420, 360, { button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  const menuBox = await page.locator('.context-menu').boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1280);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(720);

  await page.getByRole('button', { name: '切换编辑草稿' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('连续输入验证');
  await expect(page.locator('.cm-content')).toContainText('连续输入验证');
  await page.keyboard.type('无需再次点击');
  await expect(page.locator('.cm-content')).toContainText('连续输入验证无需再次点击');
  await page.keyboard.press('Control+A');
  const selectedTextLength = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  expect(selectedTextLength).toBeGreaterThan(50);
});

test('drag selection can create annotation from context menu', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await page.getByRole('button', { name: '正文编写' }).click();
  await openChapter(page, '001');
  const contentBox = await page.locator('.cm-content').boundingBox();
  expect(contentBox).not.toBeNull();
  await page.mouse.move(contentBox!.x + 90, contentBox!.y + 96);
  await page.mouse.down();
  await page.mouse.move(contentBox!.x + 310, contentBox!.y + 96, { steps: 8 });
  await page.mouse.up();
  const selectedTextLength = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  expect(selectedTextLength).toBeGreaterThan(2);

  await page.mouse.click(contentBox!.x + 315, contentBox!.y + 98, { button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.context-menu__quote')).not.toContainText('没有识别到选区');
  await page.getByRole('button', { name: '新建批注' }).click();
  await expect(page.getByText('已使用拖选文本')).toBeVisible();
  await page.getByPlaceholder('记录问题、判断或人工决策。').fill('拖选批注 E2E 验证。');
  await page.getByRole('button', { name: '添加批注' }).click();
  await expect(page.locator('.annotation-card').filter({ hasText: '拖选批注 E2E 验证。' })).toBeVisible();
});

async function switchWorkspace(page: Page) {
  await page.getByRole('button', { name: '作品/工作区入口' }).click();
  await expect(page.getByRole('heading', { name: '素材索引与短记忆' })).toBeVisible();
  await page.getByLabel('当前路径').fill(sandboxPath);
  await page.getByRole('button', { name: '切换' }).click();
  await expect(page.locator('.workspace-feedback')).toContainText('已切换到');
  await expect(page.locator('.workspace-stats').getByText('正文：2', { exact: true })).toBeVisible();
}

async function openChapter(page: Page, paddedNo: string) {
  const row = page.locator('.chapter-row').filter({ hasText: paddedNo });
  await expect(row).toHaveCount(1);
  await row.click();
}

async function activeSearchTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const active = document.querySelector('.cm-search-match--active')?.getBoundingClientRect();
    return Math.round(active?.top ?? -1);
  });
}

async function createManualAnnotation(page: Page, quote: string, comment: string) {
  const openSidebar = page.getByRole('button', { name: '打开侧栏' });
  if (await openSidebar.isVisible()) {
    await openSidebar.click();
  }
  await page.getByRole('button', { name: '手动创建批注' }).click();
  await page.getByPlaceholder('没有拖选时，可粘贴一段原文；系统会自动定位唯一匹配。').fill(quote);
  await page.getByPlaceholder('记录问题、判断或人工决策。').fill(comment);
  await page.getByRole('button', { name: '添加批注' }).click();
}

async function chapterByNo(page: Page, chapterNo: number): Promise<{ id: number; chapter_no: number; title: string }> {
  const chapters = (await (await page.request.get(`${apiBaseUrl}/api/chapters`)).json()) as Array<{
    id: number;
    chapter_no: number;
    title: string;
  }>;
  const chapter = chapters.find((item) => item.chapter_no === chapterNo);
  if (!chapter) {
    throw new Error(`Chapter ${chapterNo} not found`);
  }
  return chapter;
}

async function firstSource(page: Page, kind: string): Promise<{ id: number; kind: string; path: string }> {
  const sources = (await (await page.request.get(`${apiBaseUrl}/api/source-files`)).json()) as Array<{
    id: number;
    kind: string;
    path: string;
  }>;
  const source = sources.find((item) => item.kind === kind);
  if (!source) {
    throw new Error(`Source kind ${kind} not found`);
  }
  return source;
}

async function chapterContent(page: Page, chapterId: number): Promise<{ text: string }> {
  return (await (await page.request.get(`${apiBaseUrl}/api/chapters/${chapterId}/content`)).json()) as { text: string };
}

async function sourceContent(page: Page, sourceFileId: number): Promise<{ text: string }> {
  return (await (await page.request.get(`${apiBaseUrl}/api/source-files/${sourceFileId}`)).json()) as { text: string };
}

async function seedCandidate(page: Page, chapterId: number, text: string): Promise<{ artifact_id: number }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-candidate`, {
    data: { chapter_id: chapterId, text },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { artifact_id: number };
}

async function seedReviewedCandidate(page: Page, chapterId: number, text: string): Promise<{ artifact_id: number }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-reviewed-candidate`, {
    data: { chapter_id: chapterId, text, passed: true },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { artifact_id: number };
}

async function seedProposal(page: Page, sourceFileId: number, text: string): Promise<{ artifact_id: number }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-proposal`, {
    data: { source_file_id: sourceFileId, text },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { artifact_id: number };
}
