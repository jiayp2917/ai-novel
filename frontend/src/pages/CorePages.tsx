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

export function AiWorkbenchPage() {
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const chapterContent = useChapterContent(selectedChapterId);

  return (
    <section className="page active">
      <h2 className="page-title">AI 工作台</h2>
      <p className="page-subtitle">集中处理草稿检查、AI 修订、记忆整理与写回确认。人工写作不强制走 AI 检查。</p>
      <div className="audit-layout">
        <aside className="card catalog-card"><CatalogPanel /></aside>
        <div className="card">
          <div className="card-head"><h2>草稿检查与写回</h2><span className="chip warn">写回受控</span></div>
          <div className="pad form-grid">
            <SafetyBoundaryBanner compact />
            {chapterContent.data ? (
              <ChapterActions chapterId={chapterContent.data.id} mode="full" />
            ) : (
              <p className="muted">请选择一章正文。人工草稿可查看改动后写回；AI 草稿需要先检查。</p>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>记忆整理</h2><span className="chip blue">上下文</span></div>
          <div className="pad">
            <MemoryView />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>最近任务</h2><span className="chip">队列</span></div>
          <div className="pad">
            <JobList compact />
          </div>
        </div>
      </div>
    </section>
  );
}

export function SettingsModelsPage() {
  return (
    <section className="page active">
      <h2 className="page-title">设置/模型</h2>
      <p className="page-subtitle">管理作品路径、模型连通性、调用统计和成本提示。高级信息默认留在这里。</p>
      <div className="grid">
        <div className="card span-5">
          <div className="card-head"><h2>作品列表 / 最近打开</h2><span className="chip blue">本地</span></div>
          <div className="pad">
            <WorkspacePanel />
          </div>
        </div>
        <div className="card span-7">
          <div className="card-head"><h2>模型与调用质量</h2><span className="chip warn">高级</span></div>
          <div className="pad">
            <ModelsView />
          </div>
        </div>
      </div>
    </section>
  );
}
