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
      <div className="ai-workbench-layout">
        <aside className="ai-workbench-rail ai-workbench-rail--catalog ai-catalog-card">
          <CatalogPanel variant="ai" />
        </aside>
        <main className="ai-review-desk ai-primary-card">
          <header className="ai-review-header">
            <div>
              <p className="eyebrow">出版编辑台</p>
              <h2 className="page-title">草稿检查与正文写回</h2>
            </div>
            <ol className="ai-review-steps" aria-label="人工写回主流程">
              <li>选择草稿</li>
              <li>查看内容</li>
              <li>检查完成</li>
              <li>正式写回</li>
            </ol>
          </header>
          <div className="ai-review-body">
            <SafetyBoundaryBanner compact />
            {chapterContent.data ? (
              <ChapterActions chapterId={chapterContent.data.id} mode="full" />
            ) : (
              <div className="empty-editor-note">
                <p className="eyebrow">等待章节</p>
                <h3>先从左侧选择一章正文</h3>
                <p>选择章节后，这里会显示可检查的草稿、正文预览、改动对比和写回按钮。</p>
              </div>
            )}
          </div>
        </main>
        <aside className="ai-workbench-rail ai-workbench-rail--assistant">
          <section className="assistant-dock ai-memory-card">
            <div className="assistant-dock__head">
              <p className="eyebrow">写作参考资料</p>
              <h2>本章上下文</h2>
            </div>
            <div className="ai-card-body">
              <MemoryView compact />
            </div>
          </section>
          <section className="assistant-dock ai-jobs-card">
            <div className="assistant-dock__head">
              <p className="eyebrow">运行监控</p>
              <h2>任务时间线</h2>
            </div>
            <div className="ai-card-body">
              <JobList compact />
            </div>
          </section>
        </aside>
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
