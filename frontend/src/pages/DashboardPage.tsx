import { BookOpen, ChevronRight } from 'lucide-react';
import { useArtifacts, useChapters, useJobs } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { ActiveView, Artifact } from '../types';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';

export function DashboardPage() {
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const setSelectedChapterId = useWorkbenchStore((state) => state.setSelectedChapterId);
  const setSelectedSourceFileId = useWorkbenchStore((state) => state.setSelectedSourceFileId);
  const recentChapterIds = useWorkbenchStore((state) => state.recentChapterIds);
  const chapters = useChapters();
  const jobs = useJobs();
  const proposals = useArtifacts({ kind: 'proposal', limit: 100 });
  const candidates = useArtifacts({ kind: 'candidate', limit: 100 });
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
  const pendingProposals = (proposals.data ?? []).filter(isPendingProposal);
  const pendingDrafts = (candidates.data ?? []).filter(isPendingDraft);
  const hasRecentChapter = recentChapters.length > 0;
  const continueChapter = recentChapters[0];
  const openChapter = (chapterId: number) => {
    setSelectedChapterId(chapterId);
    setActiveView('writing');
  };

  const openProposal = (artifact?: Artifact) => {
    if (artifact?.base_source_file_id) {
      setSelectedSourceFileId(artifact.base_source_file_id);
    }
    setActiveView('planning');
  };

  const openDraft = (artifact?: Artifact) => {
    if (artifact?.base_chapter_id) {
      setSelectedChapterId(artifact.base_chapter_id);
    }
    setActiveView('ai');
  };

  const abnormalJobs = manualRequiredJobs + failedJobs;
  const totalAttention = pendingProposals.length + pendingDrafts.length + abnormalJobs + pausedBudgetJobs;
  const continueLabel = continueChapter
    ? `第 ${String(continueChapter.chapter_no).padStart(3, '0')} 章 · ${continueChapter.title}`
    : '尚未打开章节';
  const attentionItems: AttentionItem[] = [
    { label: '后台任务', value: runningJobs, detail: runningJobs ? '任务正在等待或执行。' : '没有运行中的后台任务。', view: 'pipeline' as const, tone: 'neutral' },
    {
      label: '待处理提案',
      value: pendingProposals.length,
      detail: pendingProposals.length ? '设定、章纲或写作卡等待确认。' : '暂无待处理素材提案。',
      view: 'planning' as const,
      action: () => openProposal(pendingProposals[0]),
      tone: pendingProposals.length ? 'work' : 'neutral',
    },
    {
      label: '待审草稿',
      value: pendingDrafts.length,
      detail: pendingDrafts.length ? '章节草稿等待检查或查看改动。' : '暂无待审章节草稿。',
      view: 'ai' as const,
      action: () => openDraft(pendingDrafts[0]),
      tone: pendingDrafts.length ? 'work' : 'neutral',
    },
    { label: '异常任务', value: abnormalJobs, detail: abnormalJobs ? '需要人工处理或重试。' : '暂无异常任务。', view: 'pipeline' as const, tone: abnormalJobs ? 'danger' : 'neutral' },
    { label: 'AI 调用暂停', value: pausedBudgetJobs, detail: pausedBudgetJobs ? '确认预算后可继续处理。' : 'AI 调用没有暂停。', view: 'models' as const, tone: pausedBudgetJobs ? 'warn' : 'neutral' },
  ];

  return (
    <section className="page active dashboard-page">
      <header className="page-intro dashboard-intro">
        <div className="dashboard-intro__copy">
          <p className="eyebrow">创作工作台</p>
          <h2 className="page-title">今天从哪里继续</h2>
          <p className="page-subtitle">先回到正文，再处理 AI 生成内容和需要人工确认的任务。</p>
          <div className="home-status-line" aria-label="工作台摘要">
            <span>继续位置：{continueLabel}</span>
            <span>待确认：{totalAttention}</span>
            <span>运行中：{runningJobs}</span>
          </div>
        </div>
        <div className="home-actions">
          <Button variant="primary" onClick={() => (continueChapter ? openChapter(continueChapter.id) : setActiveView('writing'))}>
            {hasRecentChapter ? '继续最近章节' : '进入写作'}
          </Button>
          <Button variant="secondary" onClick={() => setActiveView('ai')}>查看待审草稿</Button>
          <Button variant="ghost" onClick={() => setActiveView('pipeline')}>流水线状态</Button>
        </div>
      </header>

      <div className="dashboard-main-grid">
        <div className="card home-attention-card">
          <div className="card-head">
            <div>
              <h2>待处理事项</h2>
              <p>按创作风险排序，先看需要人工确认的内容。</p>
            </div>
          </div>
          <div className="attention-list">
            {attentionItems.map((item) => (
              <button
                type="button"
                className={`attention-item attention-item--${item.tone}`}
                key={item.label}
                onClick={() => (item.action ? item.action() : setActiveView(item.view))}
              >
                <span className="attention-item__label">{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
                <ChevronRight className="attention-item__arrow" size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <div className="card home-recent-card">
          <div className="card-head">
            <div>
              <h2>最近章节</h2>
              <p>保留最近打开的章节入口，方便回到正文。</p>
            </div>
          </div>
          <div className="chapter-list">
            {recentChapters.map((chapter) => (
              <button type="button" className="chapter-list-item" key={chapter.id} onClick={() => openChapter(chapter.id)}>
                <strong>第 {String(chapter.chapter_no).padStart(3, '0')} 章</strong>
                <span>{chapter.title}</span>
                <ChevronRight className="chapter-list-item__arrow" size={16} aria-hidden="true" />
              </button>
            ))}
            {!recentChapters.length && (
              <EmptyState icon={<BookOpen size={28} />} title="还没有最近章节" description="进入写作并打开章节后，这里会显示继续写作入口。" action="进入写作" onAction={() => setActiveView('writing')} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

type AttentionItem = {
  label: string;
  value: number;
  detail: string;
  view: ActiveView;
  action?: () => void;
  tone: 'neutral' | 'work' | 'warn' | 'danger';
};

function isPendingProposal(artifact: Artifact): boolean {
  const metadata = artifact.metadata ?? {};
  if (metadata.canonical === true || artifact.latest_publish) {
    return false;
  }
  if (artifact.kind !== 'proposal') {
    return false;
  }
  if (!artifact.latest_review) {
    return true;
  }
  return artifact.latest_review.manual_required || !artifact.latest_review.passed;
}

function isPendingDraft(artifact: Artifact): boolean {
  if (artifact.kind !== 'candidate' || artifact.latest_publish) {
    return false;
  }
  const source = typeof artifact.metadata?.source === 'string' ? artifact.metadata.source : '';
  if (source === 'manual_editor_draft') {
    return false;
  }
  return !artifact.latest_review || artifact.latest_review.manual_required || !artifact.latest_review.passed;
}
