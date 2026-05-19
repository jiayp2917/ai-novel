import { useEffect } from 'react';
import { TaskPanel } from './components/TaskPanel';
import { useCostDashboard, useHealth } from './hooks';
import { DashboardPage } from './pages/DashboardPage';
import { MemoryPage, ModelsPage, PipelinePage, PlanningPage, PublishPage, ReviewPage, WorkspacePage, WritingPage } from './pages/CorePages';
import { useWorkbenchStore } from './store';
import type { ActiveView } from './types';

const navItems: Array<{ id: ActiveView; icon: string; label: string }> = [
  { id: 'home', icon: '⌂', label: '首页工作台' },
  { id: 'workspace', icon: '▦', label: '作品/工作区入口' },
  { id: 'writing', icon: '✎', label: '正文编写' },
  { id: 'planning', icon: '☷', label: '设定/章纲' },
  { id: 'pipeline', icon: '⇄', label: '自动流水线' },
  { id: 'review', icon: '✓', label: '审核中心' },
  { id: 'fix_publish', icon: '⇪', label: '修复发布' },
  { id: 'memory', icon: '◇', label: '记忆库' },
  { id: 'models', icon: '⚙', label: '模型任务' },
];

const viewTitles: Record<ActiveView, string> = {
  home: '首页工作台',
  workspace: '作品/工作区入口',
  writing: '正文编写',
  planning: '设定/章纲',
  pipeline: '自动流水线',
  review: '审核中心',
  fix_publish: '修复发布',
  memory: '记忆库',
  models: '模型任务',
};

export function App() {
  const activeView = useWorkbenchStore((state) => state.activeView);
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const theme = useWorkbenchStore((state) => state.theme);
  const toggleTheme = useWorkbenchStore((state) => state.toggleTheme);
  const health = useHealth();
  const cost = useCostDashboard();
  const workspaceRoot = health.data?.workspace?.root ?? health.data?.content_root ?? '未连接工作区';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app prototype-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>小说编辑器</h1>
          <p>长篇创作安全工作台</p>
        </div>
        <nav className="nav" aria-label="主导航">
          {navItems.map((item) => (
            <button
              className={item.id === activeView ? 'active' : ''}
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
            >
              <span className="ico">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-note">
          安全边界：正文写回必须经过候选、审核、发布门；模型调用与正文编写分离。
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">
            <strong>{viewTitles[activeView]}</strong>
            <span> / 长篇创作安全流</span>
          </div>
          <div className="top-actions">
            <span className="chip blue" title={workspaceRoot}>当前工作区：{workspaceRoot}</span>
            <span className="chip">今日调用 {cost.data?.today_model_calls ?? 0} 次</span>
            <button className="btn" type="button" onClick={toggleTheme}>{theme === 'dark' ? '浅色' : '深色'}</button>
            <button className="btn" type="button" onClick={() => setActiveView('workspace')}>工作区</button>
            <button className="btn primary" type="button" onClick={() => setActiveView('models')}>新建模型任务</button>
          </div>
        </header>
        <TaskPanel />

        {activeView === 'home' && <DashboardPage />}
        {activeView === 'workspace' && <WorkspacePage />}
        {activeView === 'writing' && <WritingPage />}
        {activeView === 'planning' && <PlanningPage />}
        {activeView === 'pipeline' && <PipelinePage />}
        {activeView === 'review' && <ReviewPage />}
        {activeView === 'fix_publish' && <PublishPage />}
        {activeView === 'memory' && <MemoryPage />}
        {activeView === 'models' && <ModelsPage />}
      </main>
    </div>
  );
}
