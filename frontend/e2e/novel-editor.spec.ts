import { expect, test, type Page } from '@playwright/test';

const sandboxPath = String.raw`D:\2917\numeric-monster\runtime\sandbox_workspace`;
const apiBaseUrl = 'http://127.0.0.1:18080';

test('new user 10-minute path can add workspace, scan, read, save version, publish, and see history', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '首页工作台' })).toBeVisible();
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
  await page.locator('.cm-content').click();
  await page.keyboard.type('\n新手路径正文版本保存验证。');
  await page.getByRole('button', { name: '保存正文版本' }).click();
  await expect(page.locator('.task-latest')).toContainText('正文版本已保存');
  await expect(page.locator('.annotations-panel')).toBeVisible();
  await expect(page.locator('.inspector-tab--active')).toHaveText('版本');
  await expect(page.locator('.version-history')).toContainText('正文版本');
  const savedVersion = page.locator('.history-card--active');
  await expect(savedVersion).toBeVisible();
  await expect(savedVersion.getByRole('button', { name: '正在查看' })).toBeVisible();
  await expect(page.locator('.reader-header h1')).toContainText('历史版本');
  await expect(page.locator('.cm-content')).toContainText('新手路径正文版本保存验证');
  await expect(savedVersion.getByRole('button', { name: '删除版本' })).toBeEnabled();
  await expect(page.locator('.history-card--current').getByRole('button', { name: '当前正文不可删' })).toBeDisabled();
  await savedVersion.getByRole('button', { name: '发布此版本' }).click();
  await expect(page.getByRole('dialog', { name: '确认发布正文版本' })).toBeVisible();
  await page.getByRole('button', { name: '确认发布' }).click();
  await expect(page.locator('.task-latest')).toContainText('已发布');
  const chapterAfterManualPublish = await chapterContent(page, 1);
  expect(chapterAfterManualPublish.text).toContain('新手路径正文版本保存验证');

  const themeBefore = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: /界面风格/ }).first().click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', themeBefore === 'anime' ? 'bright' : 'anime');
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
  await expect(page.locator('.page.active')).toContainText('提案只用于改进设定和章纲');
  await expect(page.locator('.page.active')).not.toContainText('确认写回正文');
  await expect(page.locator('.page.active .catalog-section--chapters')).toHaveCount(0);
  await expect(page.locator('.page.active')).not.toContainText('未识别正文文件');
  const settingsToggle = page.locator('.catalog-toggle').filter({ hasText: '小说设定' });
  if ((await settingsToggle.getAttribute('aria-expanded')) !== 'true') {
    await settingsToggle.click();
  }
  await page.locator('.source-row').filter({ hasText: '01-设定' }).click();
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
  await page.getByRole('button', { name: '查看改动' }).click();
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
  await settingsEntry(page).click();
  await expect(page.locator('.crumb')).toContainText('设置/模型');
  await expect(mainNav(page, '设置/模型')).toHaveCount(0);
  await expect(page.locator('.side-note')).toHaveCount(0);
  await expect(page.locator('.top-actions').getByRole('button', { name: /^工作区$/ })).toHaveCount(0);
  await mainNav(page, 'AI 素材库').click();
  await expect(page.locator('.page.active .catalog-section--chapters')).toHaveCount(0);
  await expect(page.locator('.page.active').getByRole('button', { name: '新增' })).toBeVisible();
  await page.getByRole('button', { name: '新增' }).click();
  await expect(page.getByRole('dialog', { name: '新增素材' })).toBeVisible();
  await expect(page.getByLabel('类型').locator('option')).toHaveText(['系统设定', '小说设定', '章纲']);
  await page.getByRole('button', { name: '取消' }).click();
  await page.locator('.workspace-chip--button').click();
  await expect(page.locator('.crumb')).toContainText('设置/模型');

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
  await expect(page.locator('.page-editor')).not.toContainText(/正文校验|文件校验/);
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

  const outlineToggle = page.locator('.catalog-toggle').filter({ hasText: '章纲' });
  await expect(outlineToggle).toHaveAttribute('aria-expanded', 'false');
  await outlineToggle.click();
  await expect(outlineToggle).toHaveAttribute('aria-expanded', 'true');
  await outlineToggle.click();
  await expect(outlineToggle).toHaveAttribute('aria-expanded', 'false');

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

  await page.getByRole('button', { name: '编辑正文', exact: true }).click();
  const longInput = '连续输入二百字验收：这段文本用于验证正文编辑模式不会在输入一个字符后丢失焦点，作者可以像普通编辑器一样持续写作。系统只把内容先保存为正文版本，不会直接覆盖正式正文。'.repeat(2);
  await page.keyboard.type(longInput);
  await expect(page.locator('.cm-content')).toContainText(longInput);
  const fullEditorText = await page.locator('.cm-content').innerText();
  expect(fullEditorText.trimEnd().endsWith(longInput)).toBeTruthy();
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
  await page.getByLabel('卷/文件夹').fill('06卷');
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

  await openSettings(page);
  await page.evaluate(() => {
    const pageElement = document.querySelector('.page.active');
    pageElement?.scrollTo({ top: pageElement.scrollHeight });
  });
  await expect(page.getByText('查看调用边界')).toBeVisible();
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
      pageOverflowsDocument: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      layout: read('.ai-workbench-layout'),
      catalog: read('.ai-catalog-card .catalog-scroll'),
      memory: read('.ai-memory-card .ai-card-body'),
      jobs: read('.job-list--compact'),
      jobCards: document.querySelectorAll('.job-list--compact .job-card').length,
    };
  });

  expect(metrics.pageOverflowsDocument).toBeFalsy();
  expect(metrics.layout?.height ?? 0).toBeLessThanOrEqual(560);
  expect(metrics.catalog?.overflowY).toBe('auto');
  expect(metrics.memory?.overflowY).toBe('auto');
  expect(metrics.jobs?.overflowY).toBe('auto');
  expect(metrics.jobCards).toBeLessThanOrEqual(8);
  await expect(page.locator('.job-list--compact')).toContainText('仅显示最近 8 条任务');
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
  await expect(primary).toContainText('草稿检查与写回');
  await expect(primary.getByRole('button', { name: '上下文预览', exact: true })).toBeVisible();
  await expect(primary.getByRole('button', { name: '按批注创建修订', exact: true })).toBeVisible();
  await expect(primary.getByRole('button', { name: '继续处理队列', exact: true })).toBeVisible();
  await expect(primary).not.toContainText('运行任务一次');
  await expect(primary).not.toContainText('snapshot-candidate');
  await expect(primary.locator('details.advanced-details').filter({ hasText: '高级选择草稿' })).toBeVisible();
  await expect(primary).not.toContainText(/artifact_id|raw JSON|provider|token|手动输入草稿编号/);
  await expect(primary.locator('details.advanced-details').filter({ hasText: '高级操作：检查当前正文副本' })).toBeVisible();
  await expect(primary.getByRole('button', { name: '创建待检查副本', exact: true })).toHaveCount(0);

  await primary.getByText('高级操作：检查当前正文副本').click();
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
  await page.getByRole('button', { name: '查看改动' }).click();
  await expect(page.locator('.diff-preview')).toContainText('未审核 AI 草稿写回拦截');
  await expect(page.getByRole('button', { name: '确认写回正文' })).toBeDisabled();
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
  await page.getByRole('button', { name: '查看改动' }).click();
  await expect(page.locator('.diff-preview')).toContainText('hash mismatch 验证');

  await mutateChapterSource(page, chapter.id, '\n\n外部改动：触发 hash mismatch。');
  await page.getByRole('button', { name: '确认写回正文' }).click();
  await expect(page.locator('.task-latest')).toContainText('源文件已变化，请重新扫描并重新生成候选。', { timeout: 10000 });
});

test('budget pause is visible in author language and can be resumed from AI task page', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);
  const paused = await seedBudgetPausedJob(page);

  await page.reload();
  await openSettings(page);
  await expect(page.getByText('今日调用额度已暂停').first()).toBeVisible();
  await expect(page.locator('.job-card').filter({ hasText: String(paused.job_id) })).toContainText('今日调用额度已暂停');

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
  await expect(page.locator('.quality-grid')).toBeVisible();
  await expect(page.locator('.quality-card')).toHaveCount(3);
  await expect(page.locator('.quality-card').nth(0)).toContainText('1');
  await expect(page.locator('.quality-card').nth(1)).toContainText('2000-2600');
  await expect(page.locator('.quality-card').nth(2)).toContainText('0');
  await expect(page.locator('[aria-label="按分工统计"]')).toContainText('AI 检查');
  await expect(page.locator('[aria-label="按分工统计"]')).toContainText('88');
  await expect(page.locator('.context-budget-list')).toBeVisible();
  await expect(page.locator('.context-budget-card')).toContainText('timeline');
  await expect(page.locator('.context-budget-card')).toContainText('500');
  await expect(page.locator('.route-card').first()).toContainText('已配置，可测试连通');
  await expect(page.locator('.route-card').first().locator('div').first()).not.toContainText('/');
  await page.locator('.route-card').first().getByText('查看模型配置').click();
  await expect(page.locator('.route-card').first()).toContainText('/');
  await expect(page.getByText('本地记录仅供排错')).toBeVisible();
  await page.getByText('查看 Skills').click();
  await expect(page.locator('.skill-card').first()).toContainText(/参与最近一次记录的上下文|最近一次记录的上下文未使用/);
  await expect(page.locator('.skill-card').filter({ hasText: '参与最近一次记录的上下文' })).toHaveCount(2);
});

test('cyberpunk theme keeps core work areas readable and uses project visual assets', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  const theme = await page.locator('html').getAttribute('data-theme');
  if (theme !== 'anime') {
    await page.getByRole('button', { name: /界面风格/ }).first().click();
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'anime');
  await mainNav(page, '首页').click();
  await expect(page.locator('.dashboard-hero__visual img')).toHaveAttribute('alt', '赛博朋克小说创作工作台');
  await expect(page.locator('.dashboard-hero__visual img')).toBeVisible();

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
    expect(color, `${name} should not be transparent in anime theme`).not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(colors.taskPanel, 'task panel should not fall back to light gray in cyberpunk theme').not.toBe('rgba(255, 255, 255, 0.88)');
  expect(colors.chapterTabs, 'chapter tabs should match dark chrome in cyberpunk theme').not.toBe('rgba(255, 255, 255, 0.88)');
  expect(colors.paperText, 'paper text should use readable dark ink on light paper').toBe('rgb(31, 47, 58)');
});

test('home and writing pages keep engineering details out of the main flow', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/');
  await switchWorkspace(page);

  await mainNav(page, '首页').click();
  await expect(page.locator('.top-actions')).not.toContainText('今日调用');
  await expect(page.locator('.dashboard-page')).not.toContainText(/今日调用|仅本地记录|候选池|发布门|流水线阶段接入中|token|provider|artifact|hash|raw JSON/);
  await expect(page.locator('.dashboard-page')).toContainText('版本安全');
  await expect(page.locator('.dashboard-page')).toContainText('AI 辅助');
  await expect(page.locator('.dashboard-page')).toContainText('改动可查');

  await mainNav(page, '写作').click();
  await openChapter(page, '001');
  await expect(page.locator('.top-actions')).not.toContainText('今日调用');
  await expect(page.locator('.task-panel')).not.toContainText(/调用|成本|输入|输出|缓存|供应商|token|provider/);
  await expect(page.locator('.page-editor')).not.toContainText(/artifact_id|provider|token|raw JSON|snapshot-candidate/);
});

test('pipeline wizard can create, pause, resume, run once, and show 10-chapter timeline', async ({ page }) => {
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
  await page.getByLabel('每批章节数').fill('3');
  await page.getByLabel('最大修订轮次').fill('2');
  await page.getByRole('button', { name: '创建自动流水线' }).click();
  await expect(page.locator('.task-latest')).toContainText('自动流水线');
  await expect(page.locator('.pipeline-run-item').first()).toContainText('第 1-10 章');
  await expect(page.locator('.pipeline-report-summary')).toContainText('任务结束后生成轻量报告');

  await page.locator('.pipeline-detail-grid .workflow-card').nth(1).getByRole('button', { name: '删除记录' }).click();
  await expect(page.getByRole('dialog', { name: '确认删除流水线记录' })).toContainText('这条流水线还没有结束');
  await expect(page.getByRole('button', { name: '确认删除' })).toBeDisabled();
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.locator('.pipeline-status-grid')).toContainText('已暂停');
  await expect(page.locator('.pipeline-next-step')).toContainText('已暂停');
  await page.locator('.pipeline-detail-grid .workflow-card').nth(1).getByRole('button', { name: '恢复' }).click();
  await expect(page.locator('.pipeline-status-grid')).toContainText('等待执行');
  await expect(page.locator('.pipeline-next-step')).toContainText('运行一次队列');

  await page.getByRole('button', { name: '运行一次队列' }).click();
  await expect(page.locator('.pipeline-chapter-card')).toHaveCount(10);
  await expect(page.locator('.pipeline-chapter-card').first()).toContainText('生成草稿');
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
  await expect(page.locator('.pipeline-report-summary')).toContainText('reports/pipeline_run_');
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
  await expect(page.locator('.pipeline-report-summary')).toContainText('任务结束后生成轻量报告');
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
  await expect(page.locator('.annotation-card').filter({ hasText: '拖选批注 E2E 验证。' })).toBeVisible();
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
  await openSettings(page);
}

function mainNav(page: Page, name: string) {
  return page.locator('.nav button').filter({ hasText: name });
}

function settingsEntry(page: Page) {
  return page.locator('.sidebar-settings');
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
