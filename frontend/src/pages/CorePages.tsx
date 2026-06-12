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
        <p className="page-subtitle">生成提案 → 查看改动 → 人工采纳；素材提案不会直接覆盖源文件。</p>
      </header>
      <div className="outline-layout page-section">
        <aside className="card catalog-card"><CatalogPanel variant="library" /></aside>
        <div className="card">
          <div className="card-head">
            <h2>素材提案</h2>
            <span className="chip purple">仅提案</span>
          </div>
          <div className="pad form-grid">
            {sourceContent.data && sourceContent.data.kind !== 'chapters' ? (
              <>
                <pre className="document-preview">{sourceContent.data.text}</pre>
                <SourceProposalActions sourceFileId={sourceContent.data.id} sourceKind={sourceContent.data.kind} />
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
        <p className="eyebrow">草稿与写回</p>
        <h2 className="page-title">AI 工作台</h2>
        <p className="page-subtitle">选择草稿 → 查看内容和改动 → 检查完成 → 正式写回正文。</p>
      </header>
      <div className="ai-workbench-layout">
        <div className="ai-main-row">
          <aside className="card catalog-card ai-catalog-card"><CatalogPanel variant="ai" /></aside>
          <div className="card ai-primary-card">
            <div className="card-head"><h2>人工检查与写回</h2></div>
            <div className="pad form-grid ai-card-body">
              <SafetyBoundaryBanner compact />
              {chapterContent.data ? (
                <ChapterActions chapterId={chapterContent.data.id} mode="full" />
              ) : (
                <p className="muted">请先在左侧选择章节，再选择草稿、查看内容、检查完成并确认写回。</p>
              )}
            </div>
          </div>
        </div>
        <div className="ai-monitor-row">
          <div className="card ai-memory-card">
            <div className="card-head"><h2>写作参考资料</h2></div>
            <div className="pad ai-card-body">
              <MemoryView compact />
            </div>
          </div>
          <div className="card ai-jobs-card">
            <div className="card-head"><h2>任务时间线</h2></div>
            <div className="pad ai-card-body">
              <JobList compact />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SettingsPage() {
  return (
    <section className="page active page-stack settings-page">
      <header className="page-intro">
        <p className="eyebrow">本机配置</p>
        <h2 className="page-title">设置</h2>
        <p className="page-subtitle">管理作品路径和本地工作区。</p>
      </header>
      <section className="card settings-workspace-card--full">
        <div className="card-head"><h2>工作区</h2><span className="chip blue">本地</span></div>
        <div className="pad">
          <WorkspacePanel />
        </div>
      </section>
    </section>
  );
}

export function ModelsPage() {
  return (
    <section className="page active page-stack models-page">
      <header className="page-intro">
        <p className="eyebrow">AI 助手</p>
        <h2 className="page-title">模型配置与运行状态</h2>
        <p className="page-subtitle">配置模型、密钥和接口；查看运行状态和排错信息。</p>
      </header>
      <ModelsView />
    </section>
  );
}
