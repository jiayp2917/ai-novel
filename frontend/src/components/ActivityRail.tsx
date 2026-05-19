import type { ActiveView } from '../types';
import { useWorkbenchStore } from '../store';

const items: Array<{ id: ActiveView; label: string; title: string }> = [
  { id: 'home', label: '首', title: '首页' },
  { id: 'writing', label: '写', title: '正文编写' },
  { id: 'planning', label: '纲', title: '设定章纲' },
  { id: 'pipeline', label: '流', title: '自动流水线' },
  { id: 'review', label: '审', title: '审核中心' },
  { id: 'fix_publish', label: '发', title: '修复发布' },
  { id: 'memory', label: '记', title: '记忆库' },
  { id: 'models', label: '模', title: '模型任务' },
  { id: 'workspace', label: '工', title: '工作区' },
];

export function ActivityRail() {
  const activeView = useWorkbenchStore((state) => state.activeView);
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);

  return (
    <nav className="activity-rail" aria-label="小说编辑器功能区">
      {items.map((item) => (
        <button
          className={item.id === activeView ? 'activity-button activity-button--active' : 'activity-button'}
          key={item.id}
          type="button"
          title={item.title}
          onClick={() => setActiveView(item.id)}
        >
          <span>{item.label}</span>
          <small>{item.title}</small>
        </button>
      ))}
    </nav>
  );
}
