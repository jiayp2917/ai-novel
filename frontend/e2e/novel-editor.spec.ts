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
  await expect(page.locator('.task-latest')).toContainText(/正文版本 #\d+ 已保存/);
  const versionId = await page.locator('.task-latest').innerText().then((text) => {
    const match = text.match(/#(\d+)/);
    if (!match) {
      throw new Error(`Version id not found in task text: ${text}`);
    }
    return Number.parseInt(match[1], 10);
  });
  await expect(page.locator('.annotations-panel')).toBeVisible();
  await expect(page.locator('.inspector-tab--active')).toHaveText('版本');
  await expect(page.locator('.version-history')).toContainText('正文版本');
  const savedVersion = page.locator('.history-card').filter({ hasText: `#${versionId}` });
  await expect(savedVersion).toBeVisible();
  await expect(savedVersion).toHaveClass(/history-card--active/);
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
  await page.getByPlaceholder('手动输入草稿编号').fill(String(mismatch.artifact_id));
  await page.getByRole('button', { name: '绑定草稿' }).click();
  await expect(page.getByText('草稿不属于当前章节，不能在这里检查、查看改动或写回。')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看改动' })).toBeDisabled();

  await mainNav(page, '资料库').click();
  await page.locator('.catalog-toggle').filter({ hasText: '小说设定' }).click();
  await page.locator('.source-row').filter({ hasText: '01-设定' }).click();
  const setting = await firstSource(page, 'settings');
  const settingContent = await sourceContent(page, setting.id);
  const proposal = await seedProposal(page, setting.id, `${settingContent.text}\n\n测试提案。`);
  await page.getByPlaceholder('手动输入草稿编号').fill(String(proposal.artifact_id));
  await page.getByRole('button', { name: '绑定草稿' }).click();
  await expect(page.getByRole('button', { name: '提案不直接写回' })).toBeDisabled();

  await mainNav(page, 'AI 工作台').click();
  await openChapter(page, '002');
  const beforePublish = await chapterContent(page, chapterTwo.id);
  const publishMarker = '\n\n发布门沙盒验证：正文只通过候选写回。';
  const publishSeed = await seedReviewedCandidate(page, chapterTwo.id, `${beforePublish.text}${publishMarker}`);
  await page.getByPlaceholder('手动输入草稿编号').fill(String(publishSeed.artifact_id));
  await page.getByRole('button', { name: '绑定草稿' }).click();
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

  for (const title of ['首页', '写作', '资料库', 'AI 工作台', '自动流水线', '设置/模型']) {
    await mainNav(page, title).click();
    await expect(page.locator('.crumb')).toContainText(title);
  }

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
  await page.locator('.cm-content').click();
  const longInput = '连续输入二百字验收：这段文本用于验证正文编辑模式不会在输入一个字符后丢失焦点，作者可以像普通编辑器一样持续写作。系统只把内容先保存为正文版本，不会直接覆盖正式正文。'.repeat(2);
  await page.keyboard.type(longInput);
  await expect(page.locator('.cm-content')).toContainText(longInput);
  await page.keyboard.press('Control+A');
  const selectedTextLength = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  expect(selectedTextLength).toBeGreaterThan(50);
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

  await mainNav(page, '设置/模型').click();
  await page.evaluate(() => {
    const pageElement = document.querySelector('.page.active');
    pageElement?.scrollTo({ top: pageElement.scrollHeight });
  });
  await expect(page.getByText('查看调用边界')).toBeVisible();
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

  await page.getByPlaceholder('手动输入草稿编号').fill(String(failed.artifact_id));
  await page.getByRole('button', { name: '绑定草稿' }).click();
  await expect(page.locator('.artifact-trace')).toContainText('需人工判断');
  await expect(page.getByRole('button', { name: '确认写回正文' })).toBeDisabled();
  await page.getByText('查看检查问题').click();
  await expect(page.locator('.artifact-review-detail')).toContainText('需要人工判断的测试问题');
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
  await page.getByPlaceholder('手动输入草稿编号').fill(String(seeded.artifact_id));
  await page.getByRole('button', { name: '绑定草稿' }).click();
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
  await page.getByPlaceholder('手动输入草稿编号').fill(String(seeded.artifact_id));
  await page.getByRole('button', { name: '绑定草稿' }).click();
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
  await mainNav(page, '设置/模型').click();
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

  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.locator('.pipeline-status-grid')).toContainText('已暂停');
  await page.getByRole('button', { name: '恢复' }).click();
  await expect(page.locator('.pipeline-status-grid')).toContainText('等待执行');

  await page.getByRole('button', { name: '运行一次队列' }).click();
  await expect(page.locator('.task-latest')).toContainText('执行流水线');
  await expect(page.locator('.pipeline-chapter-card')).toHaveCount(10);
  await expect(page.locator('.pipeline-chapter-card').first()).toContainText('生成草稿');
  await expect(page.locator('.pipeline-progress')).toContainText('/60');
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

  const failed = await page.request.post(`${apiBaseUrl}/api/test/seed-failed-pipeline-run`);
  expect(failed.ok()).toBeTruthy();
  await page.reload();
  await mainNav(page, '自动流水线').click();
  await expect(page.locator('.pipeline-run-item').first()).toContainText('失败，可重试');
  await expect(page.locator('.pipeline-status-grid')).toContainText('失败/暂停：1');
  await expect(page.locator('.pipeline-chapter-card').first()).toContainText('失败，可重试');
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
  await mainNav(page, '设置/模型').click();
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
  await mainNav(page, '设置/模型').click();
}

function mainNav(page: Page, name: string) {
  return page.locator('.nav button').filter({ hasText: name });
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

async function activeDraftId(page: Page): Promise<number> {
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

async function seedModelQualityReport(page: Page): Promise<{ writer_artifact_id: number; fix_artifact_id: number }> {
  const response = await page.request.post(`${apiBaseUrl}/api/test/seed-model-quality-report`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { writer_artifact_id: number; fix_artifact_id: number };
}
