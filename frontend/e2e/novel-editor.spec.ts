import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const sandboxPath = path.resolve(process.cwd(), '..', 'runtime', 'sandbox_workspace');
const apiBaseUrl = 'http://127.0.0.1:18080';

test('new user 10-minute path can add workspace, scan, read, save version, publish, and see history', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '今天从哪里继续' })).toBeVisible();
  await expect(page.getByText('小说编辑器').first()).toBeVisible();

  await switchWorkspace(page);
  await expect(page.getByRole('heading', { name: '作品列表与最近打开' })).toBeVisible();
  await expect(page.locator('.workspace-current')).toContainText('sandbox_workspace');
  await expect(page.locator('.workspace-stats').getByText('素材文件：4', { exact: true })).toBeVisible();
  await expect(page.locator('.workspace-stats').getByText('正文：10', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '写作' }).click();
  await openChapter(page, '001');
  await expect(page.locator('.reader-header h1')).toContainText('第1章：开局觉醒');
  await expect(page.locator('.reader-panel')).toBeVisible();

  await createManualAnnotation(page, '李燃站在队伍最后', '新手路径：确认开篇人物位置清晰。');
  await expect(page.locator('.annotation-card').filter({ hasText: '新手路径：确认开篇人物位置清晰。' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.annotation-card').filter({ hasText: '新手路径：确认开篇人物位置清晰。' })).toBeVisible();

  await page.getByRole('button', { name: '编辑正文' }).click();
  await page.keyboard.type('\n新手路径正文版本保存验证。');
  await page.getByRole('button', { name: '保存正文版本' }).click();
  await expect(page.locator('.task-latest')).toContainText('正文版本已保存');
  await expect(page.locator('.annotations-panel')).toBeVisible();
  await expect(page.locator('.inspector-tab--active')).toHaveText('版本');
  await expect(page.locator('.version-history')).toContainText('正文版本');
  const savedVersion = page.locator('.history-card--active');
  await expect(savedVersion).toBeVisible();
  await expect(savedVersion).toHaveAttribute('role', 'button');
  await expect(page.locator('.reader-header h1')).toContainText('历史版本');
  await expect(page.locator('.cm-content')).toContainText('新手路径正文版本保存验证');
  await expect(savedVersion.getByRole('button', { name: '删除版本' })).toBeEnabled();
  await expect(savedVersion).toContainText('保存时间');
  await expect(savedVersion).toContainText('改动摘要');
  await expect(savedVersion).toContainText('发布状态');
  await expect(savedVersion).toContainText('删除说明');
  await expect(page.locator('.history-card--current').getByRole('button', { name: '当前正文不可删' })).toBeDisabled();
  await expect(page.locator('.history-card--current')).toContainText('已发布为当前正文');
  await expect(page.locator('.history-card--current')).toContainText('不可删除：当前正文必须保留');
  await page.locator('.history-card--current').click();
  await expect(page.locator('.reader-header h1')).not.toContainText('历史版本');
  const savedVersionCard = page.locator('.history-card:not(.history-card--current)').first();
  await expect(savedVersionCard).toBeVisible();
  await savedVersionCard.click();
  await expect(page.locator('.reader-header h1')).toContainText('历史版本');
  await expect(page.locator('.cm-content')).toContainText('新手路径正文版本保存验证');
  await expect(savedVersionCard.getByRole('button', { name: '先查看改动' })).toBeDisabled();
  await savedVersionCard.getByRole('button', { name: '查看改动', exact: true }).click();
  await expect(savedVersionCard).toContainText('已查看改动');
  await expect(savedVersionCard.locator('.diff-preview')).toContainText('新手路径正文版本保存验证');
  await savedVersionCard.getByRole('button', { name: '发布为当前正文' }).click();
  const publishDialog = page.getByRole('dialog', { name: '确认发布正文版本' });
  await expect(publishDialog).toBeVisible();
  await expect(publishDialog).toContainText('已经查看过改动');
  await publishDialog.getByRole('button', { name: '确认发布' }).click();
  await expect(page.locator('.task-latest')).toContainText('已发布');
  const chapterAfterManualPublish = await chapterContent(page, 1);
  expect(chapterAfterManualPublish.text).toContain('新手路径正文版本保存验证');

  const themeBefore = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: /界面风格/ }).first().click();
  await page.reload();
  const expectedTheme = themeBefore === 'breeze' ? 'stargold' : themeBefore === 'stargold' ? 'silk' : 'breeze';
  await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
});

test('safety gates reject mismatched drafts, settings proposals, and publish sandbox chapter only after checks', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  const chapterOne = await chapterByNo(page, 1);
  const chapterTwo = await chapterByNo(page, 2);
  const chapterOneContent = await chapterContent(page, chapterOne.id);
  const mismatch = await seedCandidate(page, chapterOne.id, chapterOneContent.text);

  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '002');
  await bindDraftById(page, mismatch.artifact_id);
  await expect(page.getByText('草稿不属于当前章节，不能在这里检查、查看改动或写回。')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看改动' })).toBeDisabled();

  await mainNav(page, 'AI 素材库').click();
  await expect(page.locator('.page.active')).toContainText('生成提案 → 查看改动 → 人工采纳');
  await expect(page.locator('.page.active')).toContainText('仅提案');
  await expect(page.locator('.page.active')).not.toContainText('确认写回正文');
  await expect(page.locator('.page.active .catalog-section--chapters')).toHaveCount(0);
  await expect(page.locator('.page.active')).not.toContainText('未识别正文文件');
  const settingsToggle = page.locator('.catalog-toggle').filter({ hasText: '小说设定' });
  if ((await settingsToggle.getAttribute('aria-expanded')) !== 'true') {
    await settingsToggle.click();
  }
  await page.locator('.source-row').filter({ hasText: 'content/settings' }).first().click();
  const setting = await firstSource(page, 'settings');
  const settingContent = await sourceContent(page, setting.id);
  const proposal = await seedProposal(page, setting.id, `${settingContent.text}\n\n测试提案。`);
  await bindDraftById(page, proposal.artifact_id);
  await expect(page.getByRole('button', { name: '提案不直接写回' })).toBeDisabled();
  await expect(page.locator('.page.active')).not.toContainText('确认写回正文');

  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '002');
  const beforePublish = await chapterContent(page, chapterTwo.id);
  const publishMarker = '\n\n发布门沙盒验证：正文只通过候选写回。';
  const publishSeed = await seedReviewedCandidate(page, chapterTwo.id, `${beforePublish.text}${publishMarker}`);
  await bindDraftById(page, publishSeed.artifact_id);
  await page.locator('.artifact-main-actions').getByRole('button', { name: '查看改动', exact: true }).click();
  await expect(page.locator('.diff-preview')).toContainText('发布门沙盒验证');
  await page.getByRole('button', { name: '确认写回正文' }).click();
  await expect(page.locator('.task-latest')).toContainText('已写回正文');

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

  for (const title of ['首页', '写作', 'AI 素材库', 'AI 工作台', '自动流水线']) {
    await mainNav(page, title).click();
    await expect(page.locator('.crumb')).toContainText(title);
  }
  await openSettings(page);
  await expect(page.locator('.crumb')).toContainText('设置');
  await expect(page.locator('.settings-workspace-card--full')).toContainText('工作区');
  await openModelsView(page);
  await expect(page.locator('.crumb')).toContainText('模型配置');
  await expect(page.locator('.models-section--connectivity')).toContainText('AI 助手配置');
  await expect(mainNav(page, '设置')).toHaveCount(0);
  await expect(page.locator('.side-note')).toHaveCount(0);
  await expect(page.locator('.top-actions').getByRole('button', { name: /^工作区$/ })).toHaveCount(0);
  await mainNav(page, 'AI 素材库').click();
  await expect(page.locator('.page.active .catalog-section--chapters')).toHaveCount(0);
  await expect(page.locator('.page.active').getByRole('button', { name: '新增' })).toBeVisible();
  await page.getByRole('button', { name: '新增' }).click();
  await expect(page.getByRole('dialog', { name: '新增素材' })).toBeVisible();
  await expect(page.getByLabel('类型').locator('option')).toHaveText(['小说设定', '章纲']);
  await page.getByRole('button', { name: '取消' }).click();
  await page.locator('.workspace-chip--button').click();
  await expect(page.locator('.crumb')).toContainText('设置');

  await mainNav(page, '写作').click();
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
  await expect(page.locator('.inspector-tabs button')).toHaveText(['批注', '版本', '记忆']);
  await expect(page.locator('.inspector-tabs')).not.toContainText('候选');
  await expect(page.locator('.inspector-tabs')).not.toContainText('审核');
  await expect(page.getByRole('button', { name: '审核快照' })).toHaveCount(0);
  const menuBoxForSnapshot = await page.locator('.cm-content').boundingBox();
  expect(menuBoxForSnapshot).not.toBeNull();
  await page.mouse.click(menuBoxForSnapshot!.x + 80, menuBoxForSnapshot!.y + 80, { button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.context-menu')).not.toContainText('生成审核快照');
  await expect(page.locator('.top-actions')).not.toContainText('今日调用');
  await expect(page.locator('.task-panel')).not.toContainText(/调用|成本|输入|输出|缓存|供应商/);
  await expect(page.locator('.page-editor')).not.toContainText(/artifact_id|provider|token|raw JSON|当前正文生成候选/);
  await expect(page.locator('.page-editor')).not.toContainText('snapshot-candidate');
  await expect(page.locator('.page-editor')).not.toContainText('运行任务一次');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(page.locator('.editor-shell')).toHaveClass(/inspector-hidden/);
});

test('writing workspace supports tabs, search, fullscreen, filter, and safe context menu placement', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '写作').click();
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

  await expect(page.locator('.page.active .catalog-toggle').filter({ hasText: '小说设定' })).toHaveCount(0);
  await expect(page.locator('.page.active .catalog-toggle').filter({ hasText: '章纲' })).toHaveCount(0);
  await expect(page.locator('.page.active .source-row').filter({ hasText: 'content/settings' })).toHaveCount(0);
  await expect(page.locator('.page.active .source-row').filter({ hasText: 'content/outlines' })).toHaveCount(0);

  const volumeToggle = page.locator('.volume-title').first();
  await expect(volumeToggle).toBeVisible();
  await expect(volumeToggle).toHaveAttribute('aria-expanded', 'true');
  await volumeToggle.click();
  await expect(volumeToggle).toHaveAttribute('aria-expanded', 'false');
  await volumeToggle.click();
  await expect(volumeToggle).toHaveAttribute('aria-expanded', 'true');

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
  expect(await activeSearchVisible(page)).toBeTruthy();
  await page.getByRole('button', { name: '下一处' }).click();
  await expect(page.locator('.cm-search-match--active')).toHaveCount(1);
  const secondActiveTop = await activeSearchTop(page);
  expect(secondActiveTop).not.toBe(firstActiveTop);
  expect(await activeSearchVisible(page)).toBeTruthy();

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
  await page.getByRole('button', { name: '退出全屏' }).click();
  await expect(page.locator('.editor-shell')).not.toHaveClass(/writing-fullscreen/);
  await page.getByRole('button', { name: '打开侧栏' }).click();

  const widthWithSidebar = await readerPanelWidth(page);
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(page.locator('.editor-shell')).toHaveClass(/inspector-hidden/);
  const widthWithoutSidebar = await readerPanelWidth(page);
  expect(widthWithoutSidebar).toBeGreaterThan(widthWithSidebar + 120);
  await page.getByRole('button', { name: '打开侧栏' }).click();

  const menuTargetBox = await page.locator('.cm-content').boundingBox();
  expect(menuTargetBox).not.toBeNull();
  await page.mouse.click(menuTargetBox!.x + 120, menuTargetBox!.y + 120, { button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  const menuBox = await page.locator('.context-menu').boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1280);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(720);

  const beforeEditMetrics = await page.locator('.cm-content').evaluate((node) => {
    const box = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const scroller = node.closest('.cm-scroller');
    return {
      width: box.width,
      background: style.backgroundColor,
      scrollTop: scroller?.scrollTop ?? 0,
    };
  });
  await page.getByRole('button', { name: '编辑正文', exact: true }).click();
  const afterEditMetrics = await page.locator('.cm-content').evaluate((node) => {
    const box = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const scroller = node.closest('.cm-scroller');
    return {
      width: box.width,
      background: style.backgroundColor,
      scrollTop: scroller?.scrollTop ?? 0,
    };
  });
  expect(Math.abs(afterEditMetrics.width - beforeEditMetrics.width)).toBeLessThan(2);
  expect(afterEditMetrics.background).toBe(beforeEditMetrics.background);
  expect(Math.abs(afterEditMetrics.scrollTop - beforeEditMetrics.scrollTop)).toBeLessThan(4);
  const longInput = '连续输入二百字验收：这段文本用于验证正文编辑模式不会在输入一个字符后丢失焦点，作者可以像普通编辑器一样持续写作。系统只把内容先保存为正文版本，不会直接覆盖正式正文。'.repeat(2);
  await page.keyboard.type(longInput);
  await expect(page.locator('.cm-content')).toContainText(longInput);
  const fullEditorText = await page.locator('.cm-content').innerText();
  expect(fullEditorText).toContain(longInput);
  expect(fullEditorText.trim().endsWith(longInput)).toBeTruthy();
  await page.keyboard.press('Control+A');
  const selectedTextLength = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  expect(selectedTextLength).toBeGreaterThan(50);
});

test('narrow writing viewport keeps editor usable while catalog and inspector use drawers', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '写作').click();
  await page.getByRole('button', { name: '打开目录' }).click();
  await openChapter(page, '001');
  await expect(page.locator('.reader-panel')).toBeVisible();

  await expectUsableNarrowWritingLayout(page);

  const hideCatalog = page.getByRole('button', { name: '隐藏目录' });
  if (await hideCatalog.isVisible()) {
    await hideCatalog.click();
    await expect(page.locator('.editor-shell')).toHaveClass(/catalog-hidden/);
    await expectUsableNarrowWritingLayout(page);
  }

  const openCatalog = page.getByRole('button', { name: '打开目录' });
  await expect(openCatalog).toBeVisible();
  await openCatalog.click();
  await expect(page.locator('.editor-shell')).not.toHaveClass(/catalog-hidden/);
  await expectUsableNarrowWritingLayout(page);

  await page.getByRole('button', { name: '打开侧栏' }).click();
  await expect(page.locator('.annotations-panel')).toBeVisible();
  await expectUsableNarrowWritingLayout(page);

  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(page.locator('.editor-shell')).toHaveClass(/inspector-hidden/);
  await expectUsableNarrowWritingLayout(page);
});

test('narrow navigation keeps all entry points understandable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  for (const entry of [
    { label: '首页', short: '首页' },
    { label: '写作', short: '写作' },
    { label: 'AI 素材库', short: '素材' },
    { label: 'AI 工作台', short: 'AI' },
    { label: '自动流水线', short: '流水线' },
  ]) {
    const button = page.getByRole('button', { name: `打开${entry.label}` });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('title', entry.label);
    await expect(button.locator('.nav-short-label')).toContainText(entry.short);
    await button.click();
    await expect(page.locator('.crumb')).toContainText(entry.label === '首页' ? '首页工作台' : entry.label);
  }

  const models = page.getByRole('button', { name: '打开模型配置' });
  await expect(models).toBeVisible();
  await expect(models).toHaveAttribute('title', '模型配置');
  await expect(models.locator('.nav-short-label')).toContainText('模型');
  await models.click();
  await expect(page.locator('.crumb')).toContainText('模型配置');

  const settings = page.getByRole('button', { name: '打开设置' });
  await expect(settings).toBeVisible();
  await expect(settings).toHaveAttribute('title', '设置');
  await expect(settings.locator('.nav-short-label')).toContainText('设置');
  await settings.click();
  await expect(page.locator('.crumb')).toContainText('设置');
});

test('unsaved writing version protects chapter and version switching', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '写作').click();
  await openChapter(page, '001');
  await page.getByRole('button', { name: '编辑正文' }).click();
  const unsavedMarker = '\n未保存切换保护验证。';
  await page.keyboard.type(unsavedMarker);
  await expect(page.locator('.cm-content')).toContainText('未保存切换保护验证');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('当前正文版本还未保存');
    await dialog.dismiss();
  });
  await openChapter(page, '002');
  await expect(page.locator('.reader-header h1')).toContainText('第1章');
  await expect(page.locator('.cm-content')).toContainText('未保存切换保护验证');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('切换章节或版本会丢失这次修改');
    await dialog.accept();
  });
  await openChapter(page, '002');
  await expect(page.locator('.reader-header h1')).toContainText('第2章');

  await openChapter(page, '001');
  await page.getByRole('button', { name: '编辑正文' }).click();
  await page.keyboard.type('\n未保存版本切换保护验证。');
  await page.getByRole('button', { name: '保存正文版本' }).click();
  await expect(page.locator('.history-card--active')).toBeVisible();
  await page.locator('.history-card--current').click();
  await expect(page.locator('.reader-header h1')).not.toContainText('历史版本');

  await page.getByRole('button', { name: '编辑正文' }).click();
  await page.keyboard.type('\n未保存历史版本切换保护验证。');
  const historicalVersion = page.locator('.history-card:not(.history-card--current)').first();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('当前正文版本还未保存');
    await dialog.dismiss();
  });
  await historicalVersion.click();
  await expect(page.locator('.reader-header h1')).not.toContainText('历史版本');
  await expect(page.locator('.cm-content')).toContainText('未保存历史版本切换保护验证');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('切换章节或版本会丢失这次修改');
    await dialog.accept();
  });
  await historicalVersion.click();
  await expect(page.locator('.reader-header h1')).toContainText('历史版本');
});

test('catalog can create folders, chapters, and normalize unrecognized markdown files', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '写作').click();
  await page.getByRole('button', { name: '新增' }).click();
  await expect(page.getByRole('dialog', { name: '新增素材' })).toBeVisible();
  let createDialog = page.getByRole('dialog', { name: '新增素材' });
  await expect(createDialog.locator('label[for]').filter({ hasText: '类型' })).toHaveCount(1);
  await page.getByLabel('类型').selectOption('chapter-folder');
  await expect(createDialog.locator('label[for]').filter({ hasText: '卷/文件夹' })).toHaveCount(1);
  await page.getByLabel('卷/文件夹').fill('01?');
  await page.getByRole('button', { name: '创建并扫描' }).click();
  await expect(createDialog.locator('.inline-error')).toContainText('Path component contains characters that are not allowed on Windows');
  await page.getByLabel('卷/文件夹').fill('06卷');
  await expect(createDialog.locator('.inline-error')).toBeHidden();
  await page.getByRole('button', { name: '创建并扫描' }).click();
  await expect(page.locator('.task-latest')).toContainText('素材已创建');
  await expect(page.locator('.catalog-empty-volume')).toContainText('06卷');

  await page.getByRole('button', { name: '新增' }).click();
  createDialog = page.getByRole('dialog', { name: '新增素材' });
  await page.getByLabel('类型').selectOption('chapter-file');
  await page.getByLabel('卷/文件夹').fill('06卷');
  await expect(createDialog.locator('label[for]').filter({ hasText: '章号' })).toHaveCount(1);
  await expect(createDialog.locator('label[for]').filter({ hasText: '标题' })).toHaveCount(1);
  await page.getByLabel('章号').fill('146');
  await page.getByLabel('标题').fill('新卷开篇');
  await page.getByRole('button', { name: '创建并扫描' }).click();
  await expect(page.locator('.chapter-row').filter({ hasText: '146' })).toBeVisible();
  await expect(page.locator('.reader-header h1')).toContainText('新卷开篇');

  await page.getByRole('button', { name: '新增' }).click();
  await page.getByLabel('类型').selectOption('chapter-markdown');
  await page.getByLabel('卷/文件夹').fill('06卷');
  await page.getByLabel('文件名').fill('待整理正文.md');
  await page.getByLabel('初始内容').fill('这是一段没有标准章节标题的正文。');
  await page.getByRole('button', { name: '创建并扫描' }).click();
  await expect(page.locator('.catalog-subtitle--warn')).toContainText('未识别正文文件');
  const unparsed = page.locator('.unparsed-row').filter({ hasText: '待整理正文.md' });
  await expect(unparsed).toBeVisible();
  await unparsed.getByRole('button').first().click();
  await expect(page.locator('.reader-header h1')).toContainText('待整理正文.md');
  await expect(page.getByRole('button', { name: '保存文件草稿' })).toBeVisible();

  await unparsed.getByLabel('规范化章号').fill('147');
  await unparsed.getByLabel('规范化标题').fill('整理成章');
  await unparsed.getByRole('button', { name: '转为章节' }).click();
  await expect(page.locator('.task-latest')).toContainText('已生成标准章节标题');
  await expect(page.locator('.chapter-row').filter({ hasText: '147' })).toBeVisible();
  await expect(page.locator('.reader-header h1')).toContainText('整理成章');

  const reset = await page.request.post(`${apiBaseUrl}/api/test/reset-sandbox-workspace`);
  expect(reset.ok()).toBeTruthy();
});

test('status drawer floats without resizing writing area and long pages can scroll to bottom', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '写作').click();
  await openChapter(page, '001');
  const before = await readerPanelBox(page);
  await page.locator('.task-toggle').click();
  await expect(page.locator('.task-popover')).toBeVisible();
  const after = await readerPanelBox(page);
  expect(Math.abs(after.width - before.width)).toBeLessThan(2);
  expect(Math.abs(after.height - before.height)).toBeLessThan(2);
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.task-popover').getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.task-popover')).toHaveCount(0);

  await openModelsView(page);
  await page.evaluate(() => {
    const pageElement = document.querySelector('.page.active');
    pageElement?.scrollTo({ top: pageElement.scrollHeight });
  });
  await expect(page.getByText('查看调用边界')).toBeVisible();
});

test('AI workbench selects a draft card without manual id and shows readable draft context', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '001');

  const chapter = await chapterByNo(page, 1);
  const content = await chapterContent(page, chapter.id);
  const seeded = await seedAiCandidate(page, chapter.id, `${content.text}\n\n草稿卡片选择验证。`);
  await page.route(`${apiBaseUrl}/api/artifacts/${seeded.artifact_id}/review`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        artifact_id: seeded.artifact_id,
        review_id: 991,
        passed: true,
        evidence_count: 0,
        manual_required: false,
        issues: [],
      }),
    });
  });
  await page.reload();
  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '001');

  const primary = page.locator('.ai-primary-card');
  const draftCard = primary.locator('.candidate-row').filter({ hasText: 'AI 生成草稿' }).first();
  await expect(draftCard).toBeVisible();
  await expect(draftCard).toContainText('第 001 章：开局觉醒');
  await expect(draftCard).toContainText('保存：');
  await expect(draftCard).toContainText('检查：未检查');
  await expect(draftCard).toContainText('未写回');
  await expect(primary.locator('.candidate-list')).not.toContainText('手动输入草稿编号');

  await draftCard.click();
  await expect(draftCard).toHaveClass(/candidate-row--active/);
  await page.getByRole('button', { name: '检查完成' }).click();
  await expect(page.locator('.task-latest')).toContainText('人工检查');
  await page.getByRole('button', { name: '查看改动' }).click();
  await expect(page.locator('.diff-preview')).toContainText('草稿卡片选择验证');
});

test('AI workbench keeps catalog, memory, and task queue bounded inside panels', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  for (let index = 0; index < 6; index += 1) {
    await seedFailedPipelineRun(page);
  }

  await page.reload();
  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '001');
  await expect(page.locator('.ai-workbench-layout')).toBeVisible();

  const metrics = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        height: Math.round(rect.height),
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflowY: style.overflowY,
      };
    };
    return {
      viewportHeight: window.innerHeight,
      pageOverflowsDocument: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      layout: read('.ai-workbench-layout'),
      catalog: read('.ai-catalog-card .catalog-scroll'),
      memory: read('.ai-memory-card .ai-card-body'),
      jobs: read('.job-list--compact'),
      jobCards: document.querySelectorAll('.job-list--compact .job-card').length,
    };
  });

  expect(metrics.pageOverflowsDocument).toBeFalsy();
  expect(metrics.layout?.height ?? 0).toBeLessThanOrEqual(metrics.viewportHeight - 96);
  expect(metrics.catalog?.overflowY).toBe('auto');
  expect(metrics.memory?.overflowY).toBe('auto');
  expect(metrics.jobs?.overflowY).toBe('auto');
  expect(metrics.jobCards).toBeLessThanOrEqual(8);
  await expect(page.locator('.ai-jobs-card')).toContainText('仅显示最近 8 条任务');
});

test('review failure keeps draft unpublished and explains whether it needs manual judgment', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '001');

  const chapter = await chapterByNo(page, 1);
  const content = await chapterContent(page, chapter.id);
  const failed = await seedReviewedCandidate(page, chapter.id, `${content.text}\n\n失败审核验证。`, {
    passed: false,
    manual_required: true,
    issues: [
      {
        chapter: 1,
        severity: 'blocking',
        owner: 'admin',
        description: '需要人工判断的测试问题',
        evidence: '失败审核验证',
        fix_instruction: '不要发布',
      },
    ],
  });

  await bindDraftById(page, failed.artifact_id);
  await expect(page.locator('.artifact-trace')).toContainText('需人工判断');
  await expect(page.getByRole('button', { name: '确认写回正文' })).toBeDisabled();
  await page.getByText('查看检查问题').click();
  await expect(page.locator('.artifact-review-detail')).toContainText('需要人工判断的测试问题');
});

test('AI workbench keeps advanced actions and engineering fields out of the main flow', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '001');

  const workbench = page.locator('.ai-workbench-page');
  const primary = page.locator('.ai-primary-card');
  await expect(primary).toContainText('草稿检查与正文写回');
  await expect(primary.getByRole('button', { name: '按批注创建修订', exact: true })).toBeVisible();
  await expect(primary.getByRole('button', { name: '上下文预览', exact: true })).toHaveCount(0);
  await expect(primary.getByRole('button', { name: '推进待处理任务', exact: true })).toHaveCount(0);
  await expect(primary.locator('details.advanced-details').filter({ hasText: '辅助操作' })).toBeVisible();
  await expect(primary).not.toContainText('运行任务一次');
  await expect(primary).not.toContainText('snapshot-candidate');
  await expect(primary.locator('details.advanced-details').filter({ hasText: '高级选择草稿' })).toBeVisible();
  await expect(primary.locator('.candidate-list')).not.toContainText(/artifact_id|raw JSON|provider|token|手动输入草稿编号/);
  await expect(primary.locator('details.advanced-details').filter({ hasText: '排错操作：创建待检查副本' })).toBeVisible();
  await expect(primary.getByRole('button', { name: '创建待检查副本', exact: true })).toBeHidden();

  await primary.getByText('辅助操作').click();
  await expect(primary.getByRole('button', { name: '上下文预览', exact: true })).toBeVisible();
  await expect(primary.getByRole('button', { name: '推进待处理任务', exact: true })).toBeVisible();
  await primary.getByText('排错操作：创建待检查副本').click();
  await expect(primary.getByRole('button', { name: '创建待检查副本', exact: true })).toBeVisible();
  await expect(workbench).not.toContainText('运行任务一次');
});

test('unreviewed AI draft cannot be written back from the frontend', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '001');

  const chapter = await chapterByNo(page, 1);
  const content = await chapterContent(page, chapter.id);
  const seeded = await seedAiCandidate(page, chapter.id, `${content.text}\n\n未审核 AI 草稿写回拦截。`);
  await bindDraftById(page, seeded.artifact_id);
  await expect(page.locator('.artifact-trace')).toContainText('未检查');
  await expect(page.locator('.artifact-trace')).toContainText('草稿还没有检查记录');
  await expect(page.getByRole('button', { name: '确认写回正文' })).toBeDisabled();
  await page.getByRole('button', { name: '检查完成' }).click();
  await page.locator('.artifact-main-actions').getByRole('button', { name: '查看改动', exact: true }).click();
  await expect(page.locator('.diff-preview')).toContainText('未审核 AI 草稿写回拦截');
  await expect(page.getByRole('button', { name: '确认写回正文' })).toBeEnabled();
});

test('destructive AI workbench switching keeps publish gates tied to the selected draft', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '001');

  const chapter = await chapterByNo(page, 1);
  const content = await chapterContent(page, chapter.id);
  const first = await seedAiCandidate(page, chapter.id, `${content.text}\n\n破坏性切换 A。`);
  const second = await seedAiCandidate(page, chapter.id, `${content.text}\n\n破坏性切换 B。`);
  await bindDraftById(page, first.artifact_id);
  await expect(page.locator('.artifact-main-actions').getByRole('button', { name: '查看改动', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认写回正文' })).toBeDisabled();

  await page.getByRole('button', { name: '检查完成' }).click();
  await page.locator('.artifact-main-actions').getByRole('button', { name: '查看改动', exact: true }).click();
  await expect(page.locator('.diff-preview')).toContainText('破坏性切换 A');
  await expect(page.getByRole('button', { name: '确认写回正文' })).toBeEnabled();

  await bindDraftById(page, second.artifact_id);
  await expect(page.locator('.diff-preview')).toHaveCount(0);
  await expect(page.locator('.artifact-main-actions').getByRole('button', { name: '查看改动', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认写回正文' })).toBeDisabled();
  await expect(page.locator('.artifact-preview-text')).toContainText('破坏性切换 B');
});

test('publish hash mismatch tells the writer to rescan and regenerate the draft', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '001');

  const chapter = await chapterByNo(page, 1);
  const content = await chapterContent(page, chapter.id);
  const seeded = await seedReviewedCandidate(page, chapter.id, `${content.text}\n\nhash mismatch 验证。`);
  await bindDraftById(page, seeded.artifact_id);
  await page.locator('.artifact-main-actions').getByRole('button', { name: '查看改动', exact: true }).click();
  await expect(page.locator('.diff-preview')).toContainText('hash mismatch 验证');

  await mutateChapterSource(page, chapter.id, '\n\n外部改动：触发 hash mismatch。');
  await page.getByRole('button', { name: '确认写回正文' }).click();
  await expect(page.locator('.task-latest')).toContainText('源文件已变化，请重新扫描并重新生成候选。', { timeout: 10000 });
});

test('model configuration rejects invalid edits, blocks assigned deletion, and shows paused jobs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  const paused = await seedBudgetPausedJob(page);

  await page.reload();
  await openModelsView(page);
  await expect(page.locator('.models-overview__surface')).toContainText('1 个任务因预算暂停');
  await expect(page.locator('.job-card').filter({ hasText: String(paused.job_id) })).toContainText('AI 调用已暂停');

  await page.getByRole('button', { name: '新增模型' }).click();
  const createCard = page.locator('.model-profile-card').first();
  await createCard.getByLabel('档案名称').fill('破坏性测试模型');
  await createCard.getByLabel('接口地址').fill('not-a-url');
  await createCard.getByText('高级设置').click();
  await createCard.getByLabel('输出上限').fill('0');
  await createCard.getByRole('button', { name: '保存新模型' }).click();
  await expect(page.locator('.task-latest')).toContainText(/接口地址必须是有效|输出上限必须是正整数/);

  await createCard.getByLabel('接口地址').fill('https://api.chaos.local/v1');
  await createCard.getByLabel('输出上限').fill('2048');
  await createCard.getByRole('button', { name: '保存新模型' }).click();
  await expect(page.locator('.task-latest')).toContainText('破坏性测试模型 已保存');
  const savedCard = page.locator('.model-profile-card').filter({ hasText: '破坏性测试模型' });
  await expect(savedCard).toBeVisible();
  const afterCreateConfig = await page.request.get(`${apiBaseUrl}/api/admin/model-config`).then((response) => response.json()) as {
    profiles: Array<{ id: string; provider: string; built_in?: boolean; name: string }>;
  };
  const createdProfile = afterCreateConfig.profiles.find((profile) => profile.name === '破坏性测试模型');
  expect(createdProfile).toBeTruthy();

  const writerRole = page.locator('.role-assignment-row').filter({ hasText: 'AI 写作' });
  await writerRole.getByLabel('使用模型').selectOption({ label: '破坏性测试模型' });
  await writerRole.getByRole('button', { name: '保存分配' }).click();
  await expect(page.locator('.task-latest')).toContainText('AI 写作 的模型已更新');
  await savedCard.getByRole('button', { name: '删除档案' }).click();
  await expect(page.locator('.task-latest')).toContainText('模型档案正在被角色使用');

  const config = await page.request.get(`${apiBaseUrl}/api/admin/model-config`).then((response) => response.json()) as {
    profiles: Array<{ id: string; provider: string; built_in?: boolean; name: string }>;
  };
  const defaultWriterProfile = config.profiles.find((profile) => profile.built_in && profile.provider === 'agnes') ?? config.profiles.find((profile) => profile.built_in);
  expect(defaultWriterProfile).toBeTruthy();
  const restore = await page.request.patch(`${apiBaseUrl}/api/admin/model-role-assignments/writer`, {
    data: { profile_id: defaultWriterProfile!.id },
  });
  expect(restore.ok()).toBeTruthy();
  const cleanup = await page.request.delete(`${apiBaseUrl}/api/admin/model-profiles/${encodeURIComponent(createdProfile!.id)}`);
  expect([200, 404]).toContain(cleanup.status());
});

test('budget pause is visible in author language and can be resumed from AI task page', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  const paused = await seedBudgetPausedJob(page);

  await page.reload();
  await openModelsView(page);
  await expect(page.getByText('AI 调用已暂停').first()).toBeVisible();
  await expect(page.locator('.job-card').filter({ hasText: String(paused.job_id) })).toContainText('AI 调用已暂停');

  await page.getByRole('button', { name: '继续执行任务' }).click();
  await expect(page.locator('.task-latest')).toContainText('继续执行任务');
  await expect(page.locator('.job-card').filter({ hasText: String(paused.job_id) })).toContainText('已完成', { timeout: 10000 });
});

test('model task page shows quality trends and context budget warnings', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  await seedModelQualityReport(page);

  await page.reload();
  await openModelsView(page);
  await expect(page.locator('.models-page')).toBeVisible();
  await expect(page.locator('.settings-metrics-grid')).toBeVisible();
  await expect(page.locator('.quality-grid')).toBeVisible();
  await expect(page.locator('.models-overview__surface')).toContainText('AI 助手当前是否可用');
  await expect(page.locator('.models-overview__surface')).toContainText('AI 输出去向与安全边界');
  await expect(page.locator('.models-section--connectivity')).toContainText('AI 助手配置');
  await expect(page.locator('.models-section--connectivity')).toContainText('模型档案与角色分配');
  const callRecords = page.locator('.models-troubleshooting__surface');
  await expect(callRecords).toContainText('AI 请求排错记录');
  await expect(callRecords).toContainText('平时不用展开');
  await expect(callRecords.locator('.observability-table--calls')).toBeHidden();
  await expect(callRecords.getByRole('button', { name: '清理 30 天前记录' })).toBeHidden();
  await expect(page.locator('.models-section--skills')).toContainText('高级日志 / Skills');
  await expect(page.locator('.quality-card')).toHaveCount(3);
  await expect(page.locator('.quality-card').nth(0)).toContainText('1');
  await expect(page.locator('.quality-card').nth(1)).toContainText('2000-2600');
  await expect(page.locator('.quality-card').nth(2)).toContainText('0');
  await expect(page.locator('.context-budget-list')).toBeVisible();
  await expect(page.locator('.context-budget-card')).toContainText('timeline');
  await expect(page.locator('.context-budget-card')).toContainText('500');
  const profileCard = page.locator('.model-profile-card').first();
  await expect(profileCard).toContainText('模型');
  await expect(profileCard).toContainText('接口地址');
  await expect(profileCard).toContainText('密钥');
  await expect(profileCard.locator('.model-config-summary')).not.toContainText('配置来源');
  await expect(profileCard).toContainText(/可使用|缺少密钥|内置模板/);
  await expect(profileCard.locator('.model-config-summary')).not.toContainText(/provider|api_key_env|raw JSON|token/);
  await profileCard.getByText('高级设置').click();
  await expect(profileCard).toContainText('provider/model');
  const writerRoleRow = page.locator('.role-assignment-row').filter({ hasText: 'AI 写作' });
  await expect(writerRoleRow).toContainText('使用模型');
  await expect(writerRoleRow.getByRole('button', { name: '保存分配' })).toBeVisible();
  await expect(writerRoleRow.getByRole('button', { name: '测试此角色' })).toBeVisible();
  await expect(callRecords).toContainText('连接失败、费用异常或 AI 无响应时再查看');
  await callRecords.getByRole('heading', { name: 'AI 请求排错记录' }).click();
  await expect(callRecords.locator('.observability-table--calls')).toBeVisible();
  const failedCallRow = callRecords.locator('.observability-row').filter({ hasText: '失败' }).first();
  await expect(failedCallRow).toBeVisible();
  await expect(failedCallRow.locator('.model-call-error-summary')).toContainText(/缺少密钥配置|密钥验证失败|连接失败|请求失败/);
  await expect(failedCallRow.locator('.model-call-error-summary')).not.toContainText(/Missing API key|Authentication Fails|error|api key:/i);
  await callRecords.getByRole('button', { name: '只看失败' }).click();
  await expect(callRecords).toContainText('当前只显示失败请求。');
  await expect(callRecords.locator('.observability-row').filter({ hasText: '成功' })).toHaveCount(0);
  await expect(callRecords.getByRole('button', { name: '查看更多' })).toBeVisible();
  await expect(callRecords.getByText('高级清理')).toBeVisible();
  await callRecords.getByText('高级清理').click();
  await expect(callRecords.getByRole('button', { name: '清理 30 天前记录' })).toBeVisible();
  await callRecords.getByRole('button', { name: '清理 30 天前记录' }).click();
  await expect(page.getByRole('dialog', { name: '清理 AI 请求记录' })).toContainText('不会删除正文、草稿、审核、改动对比、备份或发布记录');
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByText('查看 Skills').click();
  await expect(page.locator('.skill-card').first()).toContainText(/参与最近一次记录的上下文|最近一次记录的上下文未使用/);
  await expect(page.locator('.skill-card').filter({ hasText: '参与最近一次记录的上下文' })).toHaveCount(2);
  await expect(page.locator('.skill-card').filter({ hasText: 'hallucination_guard' })).toBeVisible();
  await expect(callRecords.locator('.observability-row').first()).not.toContainText(/provider|token|base_url|JSON/);
});

test('three writing themes keep core work areas readable and use project visual assets', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  const theme = await page.locator('html').getAttribute('data-theme');
  if (theme !== 'stargold') {
    await page.getByRole('button', { name: /界面风格/ }).first().click();
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'stargold');
  await mainNav(page, '首页').click();
  await expect(page.locator('.dashboard-intro')).toBeVisible();
  await expect(page.locator('.dashboard-hero__visual img')).toHaveCount(0);

  await mainNav(page, '写作').click();
  await openChapter(page, '001');
  await expect(page.locator('.reader-panel')).toBeVisible();
  const contentBox = await page.locator('.cm-content').boundingBox();
  expect(contentBox).not.toBeNull();
  await page.mouse.click(contentBox!.x + 120, contentBox!.y + 120, { button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();

  const colors = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).backgroundColor : '';
    };
    const readColor = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).color : '';
    };
    return {
      topbar: read('.topbar'),
      taskPanel: read('.task-panel'),
      chapterTabs: read('.chapter-tabs'),
      activeChapterTab: read('.chapter-tab--active'),
      button: read('.secondary-button'),
      paper: read('.cm-content'),
      paperText: readColor('.cm-content'),
      editor: read('.editor-host'),
      menu: read('.context-menu'),
      card: read('.annotation-card'),
      input: read('input'),
    };
  });
  for (const [name, color] of Object.entries(colors)) {
    expect(color, `${name} should not be transparent in stargold theme`).not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(colors.taskPanel, 'task panel should not fall back to light gray in stargold theme').not.toBe('rgba(255, 255, 255, 0.88)');
  expect(colors.chapterTabs, 'chapter tabs should match dark chrome in stargold theme').not.toBe('rgba(255, 255, 255, 0.88)');
  expect(colors.paperText, 'paper text should use readable dark ink on light paper').toBe('rgb(32, 36, 42)');

  await page.getByRole('button', { name: /界面风格/ }).first().click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'silk');
  await mainNav(page, '首页').click();
  await expect(page.locator('.dashboard-intro')).toBeVisible();
  await page.getByRole('button', { name: /界面风格/ }).first().click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'breeze');
  await mainNav(page, '首页').click();
  await expect(page.locator('.dashboard-intro')).toBeVisible();
});

test('home and writing pages keep engineering details out of the main flow', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '首页').click();
  await expect(page.locator('.top-actions')).not.toContainText('今日调用');
  await expect(page.locator('.dashboard-page')).not.toContainText(/今日调用|仅本地记录|候选池|发布门|流水线阶段接入中|token|provider|artifact|hash|raw JSON/);
  await expect(page.locator('.dashboard-page')).toContainText('待处理事项');
  await expect(page.locator('.dashboard-page')).toContainText('最近章节');
  await expect(page.locator('.dashboard-page')).not.toContainText('当前项目');
  await expect(page.locator('.dashboard-page')).not.toContainText('快捷入口');
  await page.locator('.task-toggle').click();
  await expect(page.locator('.task-popover details.advanced-details').filter({ hasText: '查看调用和成本排错信息' })).toBeVisible();
  await page.locator('.task-popover').getByRole('button', { name: '关闭' }).click();

  await mainNav(page, '写作').click();
  await openChapter(page, '001');
  await expect(page.locator('.top-actions')).not.toContainText('今日调用');
  await expect(page.locator('.task-panel')).not.toContainText(/调用|成本|输入|输出|缓存|供应商|token|provider/);
  await expect(page.locator('.page-editor')).not.toContainText(/artifact_id|provider|token|raw JSON|snapshot-candidate/);
  await page.locator('.task-toggle').click();
  await expect(page.locator('.task-popover')).not.toContainText(/调用 \d|成本|输入 \d|输出 \d|缓存 \d|供应商/);
});

test('pipeline wizard can create, pause, resume, run once, and show 10-chapter timeline', async ({ page }) => {
  let createdPipelinePayload: Record<string, unknown> | null = null;
  await page.route('**/api/pipeline/runs', async (route) => {
    if (route.request().method() === 'POST') {
      createdPipelinePayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '自动流水线').click();
  await expect(page.getByRole('heading', { name: '批量生成、检查和修订章节草稿' })).toBeVisible();
  await expect(page.getByText('已索引正文：10 章')).toBeVisible();
  await page.getByLabel('起始章节').fill('1');
  await page.getByLabel('结束章节').fill('10');
  await page.getByLabel('执行模式').selectOption('full_auto');
  await page.getByText('高级选项').click();
  await page.getByLabel('每批章节数').fill('3');
  await page.getByLabel('最大修订轮次').fill('2');
  await expect(page.locator('.pipeline-mode-card')).toContainText('固定为预演');
  await expect(page.locator('.pipeline-mode-card')).toContainText('只预演流程，不写回正文');
  await expect(page.locator('.pipeline-mode-card').locator('input[type="checkbox"]')).toHaveCount(0);
  await page.getByRole('button', { name: '创建自动流水线' }).click();
  await expect(page.locator('.task-latest')).toContainText('自动流水线');
  await expect.poll(() => createdPipelinePayload?.dry_run).toBe(true);
  await expect(page.locator('.pipeline-run-item').first()).toContainText('第 1-10 章');
  await expect(page.locator('.pipeline-advanced-grid')).toContainText('报告：暂无');

  await page.locator('.pipeline-detail-grid .workflow-card').nth(1).getByRole('button', { name: '删除记录' }).click();
  await expect(page.getByRole('dialog', { name: '确认删除流水线记录' })).toContainText('这条流水线还没有结束');
  await expect(page.getByRole('button', { name: '确认删除' })).toBeDisabled();
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.locator('.pipeline-status-grid')).toContainText('已暂停');
  await expect(page.locator('.pipeline-next-step')).toContainText('已暂停');
  await page.locator('.pipeline-detail-grid .workflow-card').nth(1).getByRole('button', { name: '恢复' }).click();
  await expect(page.locator('.pipeline-status-grid')).toContainText('等待执行');
  await expect(page.locator('.pipeline-next-step')).toContainText('推进一次任务');
  await expect(page.locator('.pipeline-advanced-grid')).toContainText('只生成草稿，不写回正文');

  await page.getByRole('button', { name: '推进一次任务' }).click();
  await expect(page.locator('.pipeline-chapter-card')).toHaveCount(10);
  await expect(page.locator('.pipeline-chapter-card').first()).toContainText('生成章节草稿');
  await expect(page.locator('.pipeline-progress')).toContainText('/60');
  expect(await page.locator('.pipeline-run-item').count()).toBeLessThanOrEqual(20);
  const timelineStyle = await page.locator('.pipeline-chapter-timeline').evaluate((element) => getComputedStyle(element).overflowY);
  expect(timelineStyle).toBe('auto');
});

test('pipeline page can cancel a run and display retryable failure state', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '自动流水线').click();
  await page.getByLabel('起始章节').fill('1');
  await page.getByLabel('结束章节').fill('1');
  await page.getByLabel('执行模式').selectOption('review_only');
  await page.getByRole('button', { name: '创建自动流水线' }).click();
  await expect(page.locator('.pipeline-run-item').first()).toContainText('第 1-1 章');

  await page.getByRole('button', { name: '停止' }).click();
  await expect(page.locator('.pipeline-status-grid')).toContainText('已终止');
  await expect(page.locator('.pipeline-run-item').first()).toContainText('已终止');
  await expect(page.locator('.pipeline-next-step')).toContainText('复用设置');
  await expect(page.locator('.pipeline-report-chip')).toContainText('reports/pipeline_run_');
  await page.locator('.pipeline-detail-grid .workflow-card').nth(1).getByRole('button', { name: '复用设置' }).click();
  await expect(page.getByLabel('起始章节')).toHaveValue('1');
  await expect(page.getByLabel('结束章节')).toHaveValue('1');
  await page.locator('.pipeline-detail-grid .workflow-card').nth(1).getByRole('button', { name: '删除记录' }).click();
  await expect(page.getByRole('dialog', { name: '确认删除流水线记录' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '确认删除流水线记录' })).toContainText('不会删除草稿、报告、模型日志或正文');
  const confirmDelete = page.getByRole('button', { name: '确认删除' });
  await confirmDelete.click();
  await expect(page.getByRole('button', { name: '删除中...' })).toBeVisible();
  await expect(page.locator('.task-latest')).toContainText('删除流水线记录');
  await expect(page.locator('.pipeline-run-item').filter({ hasText: '已终止' })).toHaveCount(0);

  const failed = await page.request.post(`${apiBaseUrl}/api/test/seed-failed-pipeline-run`);
  expect(failed.ok()).toBeTruthy();
  await page.reload();
  await mainNav(page, '自动流水线').click();
  await expect(page.locator('.pipeline-run-item').first()).toContainText('失败，可重试');
  await expect(page.locator('.pipeline-status-grid')).toContainText('失败/暂停：1');
  await expect(page.locator('.pipeline-chapter-card').first()).toContainText('失败，可重试');
  await expect(page.locator('.pipeline-next-step')).toContainText('可重试');
  await expect(page.locator('.pipeline-failure-summary')).toContainText('第 001 章');
  await expect(page.locator('.pipeline-failure-summary')).toContainText('检查草稿');
  await expect(page.locator('.pipeline-failure-summary')).toContainText('模型返回格式错误');
  await expect(page.locator('.pipeline-failure-summary')).toContainText('可点击重试');
  await expect(page.locator('.pipeline-advanced-grid')).toContainText('报告：暂无');
  await expect(page.locator('.json-preview')).toHaveCount(0);
});

test('pipeline delete dialog shows backend update hint when delete endpoints are unavailable', async ({ page }) => {
  await page.route('**/api/pipeline/runs/*/delete', async (route) => {
    await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ detail: 'Method Not Allowed' }) });
  });
  await page.route('**/api/pipeline/runs/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ detail: 'Method Not Allowed' }) });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '自动流水线').click();
  await page.getByLabel('起始章节').fill('1');
  await page.getByLabel('结束章节').fill('1');
  await page.getByLabel('执行模式').selectOption('review_only');
  await page.getByRole('button', { name: '创建自动流水线' }).click();
  await expect(page.locator('.pipeline-run-item').first()).toContainText('第 1-1 章');
  await page.getByRole('button', { name: '停止' }).click();
  await expect(page.locator('.pipeline-status-grid')).toContainText('已终止');

  await page.locator('.pipeline-detail-grid .workflow-card').nth(1).getByRole('button', { name: '删除记录' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('dialog', { name: '确认删除流水线记录' })).toContainText('删除接口不可用，请重启后端服务后再试。');
  await expect(page.getByRole('button', { name: '确认删除' })).toBeEnabled();
});

test('drag selection can create annotation from context menu', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '写作').click();
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
  const annotationCard = page.locator('.annotation-card').filter({ hasText: '拖选批注 E2E 验证。' });
  await expect(annotationCard).toBeVisible();
  await page.locator('.cm-scroller').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await annotationCard.getByRole('button').filter({ hasText: '拖选批注 E2E 验证。' }).click();
  await expect(annotationCard).toHaveClass(/annotation-card--active/);
  await expect(page.locator('.cm-annotation--selected')).toBeVisible();
});

test('version history uses an internal scrollbar inside the right sidebar', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '写作').click();
  await openChapter(page, '001');
  await openSidebarIfClosed(page);
  await page.getByRole('button', { name: '版本', exact: true }).click();
  await expect(page.locator('.inspector-section--history')).toBeVisible();
  const scrollState = await page.locator('.inspector-section--history').evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    overflowY: window.getComputedStyle(node).overflowY,
  }));
  expect(scrollState.clientHeight).toBeGreaterThan(120);
  expect(['auto', 'scroll']).toContain(scrollState.overflowY);
  expect(scrollState.scrollHeight).toBeGreaterThanOrEqual(scrollState.clientHeight);
  await expect(page.locator('.annotations-panel')).toBeVisible();
});

test('memory learning gives feedback and learns only resolved annotations', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '写作').click();
  await openChapter(page, '001');
  await openSidebarIfClosed(page);
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  await page.getByRole('button', { name: '学习已解决批注' }).click();
  await expect(page.locator('.insight-panel')).toContainText('没有可学习的已解决批注');

  await page.getByRole('button', { name: '批注', exact: true }).click();
  await createManualAnnotation(page, '李燃站在队伍最后', '学习路径：避免开篇人物位置描述过淡。');
  const annotation = page.locator('.annotation-card').filter({ hasText: '学习路径：避免开篇人物位置描述过淡。' });
  await expect(annotation).toBeVisible();
  await annotation.getByRole('button', { name: '标为已处理' }).click();
  await expect(annotation).toContainText('已处理');

  await page.getByRole('button', { name: '记忆', exact: true }).click();
  await page.getByRole('button', { name: '学习已解决批注' }).click();
  await expect(page.locator('.insight-panel')).toContainText(/已新增 \d+ 条记忆规则|本次没有新增规则/);
});

async function switchWorkspace(page: Page) {
  await openSettings(page);
  const workspaceCard = page.locator('.workspace-card').first();
  await expect(workspaceCard.getByRole('heading', { name: '作品列表与最近打开' })).toBeVisible();
  await openSandboxWorkspace(page, workspaceCard);
  const feedback = workspaceCard.locator('.workspace-feedback');
  const failed = await feedback.textContent().then((text) => text?.includes('打开失败')).catch(() => false);
  if (failed) {
    const reset = await page.request.post(`${apiBaseUrl}/api/test/reset-sandbox-workspace`);
    expect(reset.ok()).toBeTruthy();
    await openSandboxWorkspace(page, workspaceCard);
  }
  await expect(feedback).toContainText('已打开作品');
  await expect(workspaceCard.locator('.workspace-stats').getByText('正文：10', { exact: true })).toBeVisible();
}

async function openSandboxWorkspace(page: Page, workspaceCard: ReturnType<Page['locator']>) {
  await workspaceCard.getByLabel('当前路径').fill(sandboxPath);
  await workspaceCard.getByRole('button', { name: '打开并扫描' }).click();
}

async function openModelsView(page: Page) {
  await modelsEntry(page).click();
}

function mainNav(page: Page, name: string) {
  return page.locator('.nav button').filter({ hasText: name });
}

function settingsEntry(page: Page) {
  return page.getByRole('button', { name: '打开设置' });
}

function modelsEntry(page: Page) {
  return page.getByRole('button', { name: '打开模型配置' });
}

async function openSettings(page: Page) {
  await settingsEntry(page).click();
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

async function activeSearchVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.querySelector('.cm-search-match--active')?.getBoundingClientRect();
    if (!active) return false;
    return active.top >= 0 && active.bottom <= window.innerHeight;
  });
}

async function readerPanelWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('.reader-panel')?.getBoundingClientRect().width ?? 0);
}

async function readerPanelBox(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const rect = document.querySelector('.reader-panel')?.getBoundingClientRect();
    return { width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0) };
  });
}

async function expectUsableNarrowWritingLayout(page: Page) {
  const metrics = await page.evaluate(() => {
    const writing = document.querySelector('.writing-area')?.getBoundingClientRect();
    const reader = document.querySelector('.reader-panel')?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      writingWidth: Math.round(writing?.width ?? 0),
      readerWidth: Math.round(reader?.width ?? 0),
    };
  });
  expect(metrics.writingWidth).toBeGreaterThan(160);
  expect(metrics.readerWidth).toBeGreaterThan(160);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
}

async function createManualAnnotation(page: Page, quote: string, comment: string) {
  await openSidebarIfClosed(page);
  await page.getByRole('button', { name: '手动创建批注' }).click();
  await page.getByPlaceholder('没有拖选时，可粘贴一段原文；系统会自动定位唯一匹配。').fill(quote);
  await page.getByPlaceholder('记录问题、判断或人工决策。').fill(comment);
  await page.getByRole('button', { name: '添加批注' }).click();
}

async function openSidebarIfClosed(page: Page) {
  const openSidebar = page.getByRole('button', { name: '打开侧栏' });
  if (await openSidebar.isVisible()) {
    await openSidebar.click();
  }
}

async function bindDraftById(page: Page, artifactId: number) {
  const advancedSelector = page.locator('details.advanced-details').filter({ hasText: '高级选择草稿' }).first();
  if ((await advancedSelector.getAttribute('open')) === null) {
    await advancedSelector.getByText('高级选择草稿').click();
  }
  await page.getByPlaceholder('手动输入草稿编号').fill(String(artifactId));
  await page.getByRole('button', { name: '绑定草稿' }).click();
}

async function activeDraftId(page: Page): Promise<number> {
  const advancedSelector = page.locator('details.advanced-details').filter({ hasText: '高级选择草稿' }).first();
  if ((await advancedSelector.getAttribute('open')) === null) {
    await advancedSelector.getByText('高级选择草稿').click();
  }
  const value = await page.getByPlaceholder('手动输入草稿编号').inputValue();
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Active draft id not found: ${value}`);
  }
  return parsed;
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

async function seedAiCandidate(page: Page, chapterId: number, text: string): Promise<{ artifact_id: number }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-ai-candidate`, {
    data: { chapter_id: chapterId, text },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { artifact_id: number };
}

async function seedReviewedCandidate(
  page: Page,
  chapterId: number,
  text: string,
  options: { passed?: boolean; manual_required?: boolean; issues?: Array<Record<string, unknown>> } = {},
): Promise<{ artifact_id: number }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-reviewed-candidate`, {
    data: {
      chapter_id: chapterId,
      text,
      passed: options.passed ?? true,
      manual_required: options.manual_required ?? false,
      issues: options.issues ?? [],
    },
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

async function seedReview(
  page: Page,
  artifactId: number,
  options: { passed?: boolean; manual_required?: boolean; issues?: Array<Record<string, unknown>> } = {},
): Promise<{ artifact_id: number; review_id: number; passed: boolean }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-review`, {
    data: {
      artifact_id: artifactId,
      passed: options.passed ?? true,
      manual_required: options.manual_required ?? false,
      issues: options.issues ?? [],
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { artifact_id: number; review_id: number; passed: boolean };
}

async function mutateChapterSource(page: Page, chapterId: number, marker: string): Promise<void> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/mutate-chapter-source`, {
    data: { chapter_id: chapterId, marker },
  });
  expect(response.ok()).toBeTruthy();
}

async function seedBudgetPausedJob(page: Page): Promise<{ job_id: number; status: string }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-budget-paused-job`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { job_id: number; status: string };
}

async function seedFailedPipelineRun(page: Page): Promise<{ run_id: number; child_task_id: number; status: string }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-failed-pipeline-run`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { run_id: number; child_task_id: number; status: string };
}

async function seedModelQualityReport(page: Page): Promise<{ writer_artifact_id: number; fix_artifact_id: number }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-model-quality-report`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { writer_artifact_id: number; fix_artifact_id: number };
}
