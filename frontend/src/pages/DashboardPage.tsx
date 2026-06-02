import { useChapters, useCostDashboard, useJobs, useSources } from '../hooks';
import { useWorkbenchStore } from '../store';
import animeHero from '../assets/theme/2917.png';
import cyberpunkHero from '../assets/theme/cyberpunk-theme-hero.png';

export function DashboardPage() {
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const setSelectedChapterId = useWorkbenchStore((state) => state.setSelectedChapterId);
  const recentChapterIds = useWorkbenchStore((state) => state.recentChapterIds);
  const sources = useSources();
  const chapters = useChapters();
  const cost = useCostDashboard();
  const jobs = useJobs();
  const theme = useWorkbenchStore((state) => state.theme);
  const sourceCount = sources.data?.length ?? 0;
  const chapterCount = chapters.data?.length ?? 0;
  const heroImage = theme === 'anime' ? cyberpunkHero : animeHero;
  const chapterMap = new Map((chapters.data ?? []).map((chapter) => [chapter.id, chapter]));
  const recentChapters = recentChapterIds
    .map((id) => chapterMap.get(id))
    .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter))
    .slice(0, 5);
  const allJobs = jobs.data ?? [];
  const runningJobs = allJobs.filter((job) => job.status === 'running' || job.status === 'queued').length;
  const pausedBudgetJobs = allJobs.filter((job) => job.status === 'paused_budget').length;
  const manualRequiredJobs = allJobs.filter((job) => job.status === 'manual_required').length;
  const failedJobs = allJobs.filter((job) => job.status === 'failed' || job.status === 'failed_retryable' || job.status === 'failed_terminal').length;
  const hasRecentChapter = recentChapters.length > 0;
  const continueChapter = recentChapters[0];
  const attentionItems = [
    { label: '后台任务', value: runningJobs, detail: runningJobs ? '有任务正在等待或执行。' : '当前没有运行中的后台任务。', view: 'pipeline' as const },
    { label: '需人工处理', value: manualRequiredJobs, detail: manualRequiredJobs ? '有 AI 或流水线结果需要你判断。' : '暂无需要人工处理的任务。', view: 'ai' as const },
    { label: 'AI 调用暂停', value: pausedBudgetJobs, detail: pausedBudgetJobs ? '确认预算后可到设置/模型继续处理。' : 'AI 调用没有暂停。', view: 'settings' as const },
    { label: '失败任务', value: failedJobs, detail: failedJobs ? '查看失败原因后可重试或停止。' : '暂无失败任务。', view: 'pipeline' as const },
  ];

  const openChapter = (chapterId: number) => {
    setSelectedChapterId(chapterId);
    setActiveView('writing');
  };

  return (
    <section className="page active dashboard-page">
      <section className="dashboard-hero home-hero">
        <div className="dashboard-hero__copy">
          <p className="eyebrow">本地长篇小说工作台</p>
          <h2 className="page-title">今天从哪里继续</h2>
          <p className="page-subtitle">优先处理正文、最近章节和待确认事项。AI 辅助、素材提案和自动流水线都作为写作后的下一步。</p>
          <div className="home-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => (continueChapter ? openChapter(continueChapter.id) : setActiveView('writing'))}
            >
              {hasRecentChapter ? '继续最近章节' : '进入写作'}
            </button>
            <button className="secondary-button" type="button" onClick={() => setActiveView('ai')}>处理待检查草稿</button>
            <button className="secondary-button" type="button" onClick={() => setActiveView('pipeline')}>查看自动流水线</button>
          </div>
        </div>
        <div className="dashboard-hero__visual">
          <img src={heroImage} alt={theme === 'anime' ? '赛博朋克小说创作工作台' : '动漫小说创作助手工作台'} />
        </div>
      </section>

      <div className="home-primary-grid">
        <div className="card home-current-card">
          <div className="card-head">
            <h2>当前项目</h2>
            <button className="btn" type="button" onClick={() => setActiveView('settings')}>管理作品</button>
          </div>
          <div className="work-row">
            <div className="cover">文</div>
            <div>
              <div className="row-title">当前小说项目</div>
              <div className="muted">支持旧目录：00-系统 / 01-设定 / 02-正文 / 03-章纲</div>
              <div className="chips">
                <span className="chip ok">版本安全</span>
                <span className="chip blue">AI 辅助</span>
                <span className="chip warn">改动可查</span>
              </div>
            </div>
            <button className="btn primary" type="button" onClick={() => setActiveView('writing')}>进入写作</button>
          </div>
          <div className="work-row">
            <div className="cover cover--alt">审</div>
            <div>
              <div className="row-title">AI 辅助与正文发布</div>
              <div className="muted">AI 生成内容先检查，人工保存的正文版本可确认后发布。</div>
            </div>
            <button className="btn" type="button" onClick={() => setActiveView('ai')}>打开 AI 工作台</button>
          </div>
        </div>

        <div className="card home-attention-card">
          <div className="card-head"><h2>待处理事项</h2></div>
          <div className="attention-list">
            {attentionItems.map((item) => (
              <button type="button" className="attention-item" key={item.label} onClick={() => setActiveView(item.view)}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="home-secondary-grid">
        <div className="card home-recent-card">
          <div className="card-head"><h2>最近章节</h2></div>
          <div className="chapter-list">
            {recentChapters.map((chapter) => (
              <button type="button" className="chapter-list-item" key={chapter.id} onClick={() => openChapter(chapter.id)}>
                <strong>第 {String(chapter.chapter_no).padStart(3, '0')} 章</strong>
                <span>{chapter.title}</span>
              </button>
            ))}
            {!recentChapters.length && (
              <div className="empty-state">还没有最近章节。进入写作并打开章节后，这里会显示继续写作入口。</div>
            )}
          </div>
        </div>

        <div className="card home-quick-card">
          <div className="card-head"><h2>快捷入口</h2></div>
          <div className="quick">
            <button type="button" onClick={() => setActiveView('writing')}><b>写作</b><span className="muted">编辑正文、保存版本、查看改动</span></button>
            <button type="button" onClick={() => setActiveView('planning')}><b>AI 素材库</b><span className="muted">设定、章纲、人物与伏笔</span></button>
            <button type="button" onClick={() => setActiveView('ai')}><b>AI 工作台</b><span className="muted">检查、修订、记忆整理与写回</span></button>
            <button type="button" onClick={() => setActiveView('pipeline')}><b>自动流水线</b><span className="muted">批量生成、检查和报告</span></button>
          </div>
        </div>

        <div className="home-metrics">
          <div className="card metric"><span>源文件</span><b>{sourceCount}</b><span>设定、章纲、正文索引</span></div>
          <div className="card metric"><span>正文</span><b>{chapterCount}</b><span>当前工作区章节数</span></div>
          <div className="card metric"><span>运行任务</span><b>{cost.data?.running_jobs ?? runningJobs}</b><span>需要关注的后台事项</span></div>
        </div>
      </div>
    </section>
  );
}
