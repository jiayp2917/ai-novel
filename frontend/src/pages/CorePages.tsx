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

export function WorkspacePage() {
  return (
    <section className="page active">
      <h2 className="page-title">作品/工作区入口</h2>
      <p className="page-subtitle">切换工作区、扫描素材、重建短记忆。源文件不迁移、不删除。</p>
      <WorkspacePanel />
    </section>
  );
}

export function WritingPage() {
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen);
  const catalogPanelOpen = useWorkbenchStore((state) => state.catalogPanelOpen);
  const writingFullscreen = useWorkbenchStore((state) => state.writingFullscreen);
  const shellClassName = [
    'editor-shell',
    rightPanelOpen && !writingFullscreen ? '' : 'inspector-hidden',
    catalogPanelOpen && !writingFullscreen ? '' : 'catalog-hidden',
    writingFullscreen ? 'writing-fullscreen' : '',
  ].filter(Boolean).join(' ');

  return (
    <section className="page active page-editor">
      <div className={shellClassName}>
        <aside className="chapter-pane">
          <CatalogPanel />
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
    <section className="page active">
      <h2 className="page-title">设定/章纲</h2>
      <p className="page-subtitle">设定、章纲、人物关系只能生成提案，不进入普通发布，不直接改正文。</p>
      <div className="outline-layout">
        <aside className="card catalog-card"><CatalogPanel /></aside>
        <div className="card">
          <div className="card-head">
            <h2>提案流程</h2>
            <span className="chip purple">仅提案</span>
          </div>
          <div className="pad form-grid">
            <div className="notice safe">设定/章纲输出只保存为提案，需人工采纳后进入版本，不走普通正文发布。</div>
            {sourceContent.data && sourceContent.data.kind !== 'chapters' ? (
              <>
                <pre className="document-preview">{sourceContent.data.text}</pre>
                <SourceProposalActions sourceFileId={sourceContent.data.id} />
              </>
            ) : (
              <p className="muted">请从左侧选择系统设定、小说设定或章纲文件。</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function PipelinePage() {
  return (
    <section className="page active">
      <PipelineView />
    </section>
  );
}

export function ReviewPage() {
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const chapterContent = useChapterContent(selectedChapterId);
  const sourceContent = useSourceFileContent(selectedSourceFileId);

  return (
    <section className="page active">
      <h2 className="page-title">审核中心</h2>
      <p className="page-subtitle">候选必须在这里完成证据约束审核。审核通过不等于发布。</p>
      <div className="audit-layout">
        <aside className="card catalog-card"><CatalogPanel /></aside>
        <div className="card">
          <div className="card-head"><h2>候选审核</h2><span className="chip warn">只判断</span></div>
          <div className="pad form-grid">
            <SafetyBoundaryBanner compact />
            {!selectedChapterId && !selectedSourceFileId && <p className="muted">从左侧选择正文、设定或章纲后，查看可审核候选与任务状态。</p>}
            {chapterContent.data && <ChapterActions chapterId={chapterContent.data.id} mode="review" />}
            {sourceContent.data && sourceContent.data.kind !== 'chapters' && (
              <div className="notice">设定和章纲不在前端直接覆盖源文件。请先在“设定/章纲”生成提案，再查看审核任务。</div>
            )}
            <JobList compact />
          </div>
        </div>
      </div>
    </section>
  );
}

export function PublishPage() {
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const chapterContent = useChapterContent(selectedChapterId);

  return (
    <section className="page active">
      <h2 className="page-title">修复发布</h2>
      <p className="page-subtitle">发布门是唯一允许正文写回的入口，必须具备候选、审核报告、版本快照和 diff。</p>
      <div className="publish-layout">
        <aside className="card catalog-card"><CatalogPanel /></aside>
        <div className="card">
          <div className="card-head"><h2>发布门</h2><span className="chip warn">写回受控</span></div>
          <div className="pad form-grid">
            <div className="notice danger">未满足条件时禁止发布：不会覆盖正文。</div>
            {chapterContent.data ? (
              <ChapterActions chapterId={chapterContent.data.id} mode="publish" />
            ) : (
              <p className="muted">请选择一章正文。设定和章纲保持提案流程，不提供普通发布按钮。</p>
            )}
            <JobList compact />
          </div>
        </div>
      </div>
    </section>
  );
}

export function MemoryPage() {
  return (
    <section className="page active">
      <MemoryView />
    </section>
  );
}

export function ModelsPage() {
  return (
    <section className="page active">
      <ModelsView />
    </section>
  );
}
