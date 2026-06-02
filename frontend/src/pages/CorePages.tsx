import { useEffect } from 'react';
import { AnnotationSidebar } from '../components/Annotations';
import { CatalogPanel } from '../components/CatalogPanel';
import { MemoryView } from '../components/MemoryView';
import { ModelsView } from '../components/ModelsView';
import { PipelineView } from '../components/PipelineView';
import { ReaderPanel } from '../components/ReaderPanel';
import { SafetyBoundaryBanner } from '../components/SafetyBoundaryBanner';
import { WorkspacePanel } from '../components/WorkspacePanel';
import { ChapterActions, JobList, SourceProposalActions } from '../components/WorkflowActions';
import { useChapterContent, useSourceFileContent } from '../hooks';
import { useWorkbenchStore } from '../store';

export function WritingPage() {
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen);
  const catalogPanelOpen = useWorkbenchStore((state) => state.catalogPanelOpen);
  const writingFullscreen = useWorkbenchStore((state) => state.writingFullscreen);
  const setRightPanelOpen = useWorkbenchStore((state) => state.setRightPanelOpen);
  const setCatalogPanelOpen = useWorkbenchStore((state) => state.setCatalogPanelOpen);
  const shellClassName = [
    'editor-shell',
    rightPanelOpen && !writingFullscreen ? '' : 'inspector-hidden',
    catalogPanelOpen && !writingFullscreen ? '' : 'catalog-hidden',
    writingFullscreen ? 'writing-fullscreen' : '',
  ].filter(Boolean).join(' ');

  useEffect(() => {
    if (!window.matchMedia('(max-width: 520px)').matches) {
      return;
    }
    setCatalogPanelOpen(false);
    setRightPanelOpen(false);
  }, [setCatalogPanelOpen, setRightPanelOpen]);

  return (
    <section className="page active page-editor">
      <div className={shellClassName}>
        <aside className="chapter-pane">
          <CatalogPanel variant="writing" />
        </aside>
        <section className="writing-area">
          <ReaderPanel variant="writing" />
        </section>
        <aside className="inspector">
          <AnnotationSidebar />
        </aside>
      </div>
    </section>
  );
}

export function PlanningPage() {
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const sourceContent = useSourceFileContent(selectedSourceFileId);

  return (
    <section className="page active page-stack">
      <header className="page-intro">
        <p className="eyebrow">设定与章纲</p>
        <h2 className="page-title">AI 素材库</h2>
        <p className="page-subtitle">这里只整理系统设定、小说设定和章纲，供 AI 理解作品背景。正文编辑请回到写作页。</p>
      </header>
      <div className="outline-layout page-section">
        <aside className="card catalog-card"><CatalogPanel variant="library" /></aside>
        <div className="card">
          <div className="card-head">
            <h2>素材提案</h2>
            <span className="chip purple">仅提案</span>
          </div>
          <div className="pad form-grid">
            <div className="notice safe">提案只用于改进设定和章纲，需要人工采纳；不会直接覆盖正文。</div>
            {sourceContent.data && sourceContent.data.kind !== 'chapters' ? (
              <>
                <pre className="document-preview">{sourceContent.data.text}</pre>
                <SourceProposalActions sourceFileId={sourceContent.data.id} />
              </>
            ) : (
              <p className="muted">选择设定或章纲后，可在这里查看内容并生成提案。</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function PipelinePage() {
  return (
    <section className="page active page-stack">
      <PipelineView />
    </section>
  );
}

export function AiWorkbenchPage() {
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const chapterContent = useChapterContent(selectedChapterId);

  return (
    <section className="page active ai-workbench-page">
      <header className="page-intro">
        <p className="eyebrow">草稿检查与安全写回</p>
        <h2 className="page-title">AI 工作台</h2>
        <p className="page-subtitle">按“选择章节或草稿 → 检查 → 查看改动 → 确认写回”的顺序处理。人工写作不强制走 AI 检查。</p>
      </header>
      <div className="ai-workbench-layout">
        <div className="ai-main-row">
          <aside className="card catalog-card ai-catalog-card"><CatalogPanel variant="ai" /></aside>
          <div className="card ai-primary-card">
            <div className="card-head"><h2>草稿检查与写回</h2><span className="chip warn">需要人工确认</span></div>
            <div className="pad form-grid ai-card-body">
              <SafetyBoundaryBanner compact />
              {chapterContent.data ? (
                <ChapterActions chapterId={chapterContent.data.id} mode="full" />
              ) : (
                <p className="muted">请选择一章正文。人工草稿可查看改动后写回；AI 草稿需要先检查。</p>
              )}
            </div>
          </div>
        </div>
        <div className="ai-monitor-row">
          <div className="card ai-memory-card">
            <div className="card-head"><h2>记忆与上下文</h2><span className="chip blue">观察</span></div>
            <div className="pad ai-card-body">
              <MemoryView compact />
            </div>
          </div>
          <div className="card ai-jobs-card">
            <div className="card-head"><h2>AI 运行监控</h2><span className="chip">任务队列</span></div>
            <div className="pad ai-card-body">
              <JobList compact />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SettingsModelsPage() {
  return (
    <section className="page active page-stack settings-page">
      <header className="page-intro">
        <p className="eyebrow">本机配置</p>
        <h2 className="page-title">设置/模型</h2>
        <p className="page-subtitle">先管理作品路径和 AI 助手是否可用；调用记录、事件和高级排错信息放在下方分区。</p>
      </header>
      <div className="settings-dashboard-grid">
        <section className="card settings-workspace-card">
          <div className="card-head"><h2>工作区</h2><span className="chip blue">本地</span></div>
          <div className="pad">
            <WorkspacePanel />
          </div>
        </section>
        <section className="card settings-model-card">
          <div className="card-head"><h2>AI 助手配置与运行状态</h2><span className="chip warn">可配置</span></div>
          <div className="pad">
            <ModelsView />
          </div>
        </section>
      </div>
    </section>
  );
}
