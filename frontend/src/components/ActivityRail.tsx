import type { ActiveView } from '../types';
import { useWorkbenchStore } from '../store';

const items: Array<{ id: ActiveView; label: string; title: string }> = [
  { id: 'home', label: '首', title: '首页' },
  { id: 'writing', label: '写', title: '写作' },
  { id: 'planning', label: '资', title: '资料库' },
  { id: 'ai', label: 'AI', title: 'AI 工作台' },
  { id: 'pipeline', label: '流', title: '自动流水线' },
  { id: 'settings', label: '设', title: '设置/模型' },
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
