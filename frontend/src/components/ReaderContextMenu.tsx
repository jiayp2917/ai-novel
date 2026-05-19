import type { ContextMenuState, SelectionRange } from '../types';

export function ReaderContextMenu({
  menu,
  selection,
  dirty,
  canAnnotateSelection,
  canSaveDraft,
  hasChapter,
  savingDraft,
  snapshotting,
  onCreateAnnotation,
  onStartEditing,
  onSaveDraft,
  onSnapshot,
  onOpenSidebar,
}: {
  menu: ContextMenuState;
  selection: SelectionRange | null;
  dirty: boolean;
  canAnnotateSelection: boolean;
  canSaveDraft: boolean;
  hasChapter: boolean;
  savingDraft: boolean;
  snapshotting: boolean;
  onCreateAnnotation: () => void;
  onStartEditing: () => void;
  onSaveDraft: () => void;
  onSnapshot: () => void;
  onOpenSidebar: () => void;
}) {
  if (!menu) {
    return null;
  }

  return (
    <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
      {selection && <p className="context-menu__quote">{selection.text.slice(0, 96)}</p>}
      {dirty && <p className="context-menu__quote">当前是未发布正文版本，不能直接写入源文件批注；请先保存正文版本。</p>}
      {!selection && !dirty && <p className="context-menu__quote">没有识别到选区，可在右侧手动粘贴一段原文创建批注。</p>}
      <button type="button" onClick={onCreateAnnotation} disabled={!canAnnotateSelection}>
        新建批注
      </button>
      <button type="button" onClick={onStartEditing}>
        切换编辑正文
      </button>
      <button type="button" onClick={onSaveDraft} disabled={!canSaveDraft || savingDraft}>
        保存正文版本
      </button>
      {hasChapter && (
        <button type="button" onClick={onSnapshot} disabled={snapshotting}>
          生成审核快照
        </button>
      )}
      <button type="button" onClick={onOpenSidebar}>
        打开右侧栏
      </button>
    </div>
  );
}
