import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ContextMenuState, SelectionRange } from '../../types';
import { Surface } from '../ui/Surface';

type ReaderContextMenuProps = {
  menu: ContextMenuState;
  selection: SelectionRange | null;
  dirty: boolean;
  canAnnotateSelection: boolean;
  canSaveDraft: boolean;
  savingDraft: boolean;
  onCreateAnnotation: () => void;
  onStartEditing: () => void;
  onSaveDraft: () => void;
  onOpenSidebar: () => void;
  onClose: () => void;
};

export function ReaderContextMenu({
  menu,
  selection,
  dirty,
  canAnnotateSelection,
  canSaveDraft,
  savingDraft,
  onCreateAnnotation,
  onStartEditing,
  onSaveDraft,
  onOpenSidebar,
  onClose,
}: ReaderContextMenuProps) {
  useEffect(() => {
    if (!menu) {
      return undefined;
    }
    const close = () => onClose();
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }

  return createPortal(
    <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
      <Surface variant="paper" className="context-menu__surface">
        {selection && <p className="context-menu__quote">{selection.text.slice(0, 96)}</p>}
        {dirty && <p className="context-menu__quote">当前是未发布正文版本，不能直接写入源文件批注；请先保存正文版本。</p>}
        {!selection && !dirty && (
          <p className="context-menu__quote">没有识别到选区，可在右侧手动粘贴一段原文创建批注。</p>
        )}
        <button type="button" onClick={onCreateAnnotation} disabled={!canAnnotateSelection}>
          新建批注
        </button>
        <button type="button" onClick={onStartEditing}>
          切换编辑正文
        </button>
        <button type="button" onClick={onSaveDraft} disabled={!canSaveDraft || savingDraft}>
          保存正文版本
        </button>
        <button type="button" onClick={onOpenSidebar}>
          打开右侧栏
        </button>
      </Surface>
    </div>,
    document.body,
  );
}