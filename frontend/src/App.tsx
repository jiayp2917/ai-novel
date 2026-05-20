import { useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TaskPanel } from './components/TaskPanel';
import { useCostDashboard, useHealth } from './hooks';
import { DashboardPage } from './pages/DashboardPage';
import { AiWorkbenchPage, PipelinePage, PlanningPage, SettingsModelsPage, WritingPage } from './pages/CorePages';
import { useWorkbenchStore } from './store';
import { nextTheme, themeLabels } from './theme';
import type { ActiveView } from './types';

const navItems: Array<{ id: ActiveView; icon: string; label: string }> = [
  { id: 'home', icon: '⌂', label: '首页' },
  { id: 'writing', icon: '✎', label: '写作' },
  { id: 'planning', icon: '☷', label: 'AI 素材库' },
  { id: 'ai', icon: '◇', label: 'AI 工作台' },
  { id: 'pipeline', icon: '⇄', label: '自动流水线' },
];

const viewTitles: Record<ActiveView, string> = {
  home: '首页工作台',
  writing: '写作',
  planning: 'AI 素材库',
  pipeline: '自动流水线',
  ai: 'AI 工作台',
  settings: '设置/模型',
};

export function App() {
  const activeView = useWorkbenchStore((state) => state.activeView);
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const theme = useWorkbenchStore((state) => state.theme);
  const toggleTheme = useWorkbenchStore((state) => state.toggleTheme);
  const health = useHealth();
  const cost = useCostDashboard();
  const workspaceRoot = health.data?.workspace?.root ?? health.data?.content_root ?? '未连接工作区';
  const workspaceLabel = shortWorkspaceLabel(workspaceRoot);
  const themeShortLabel = theme === 'bright' ? '主题1' : '主题2';

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
        <button
          className={activeView === 'settings' ? 'sidebar-settings active' : 'sidebar-settings'}
          type="button"
          onClick={() => setActiveView('settings')}
        >
          <span className="ico">⚙</span>
          <span>设置/模型</span>
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">
            <strong>{viewTitles[activeView]}</strong>
            <span> / 长篇创作安全流</span>
          </div>
          <div className="top-actions">
            <button
              className="chip blue workspace-chip workspace-chip--button"
              type="button"
              title={workspaceRoot}
              onClick={() => setActiveView('settings')}
            >
              当前工作区：{workspaceLabel}
            </button>
            <span className="chip calls-chip">今日调用 {cost.data?.today_model_calls ?? 0} 次</span>
            <button
              className="btn theme-switch theme-switch--compact"
              type="button"
              onClick={toggleTheme}
              title={`当前：${themeLabels[theme]}，点击切换为${themeLabels[nextTheme(theme)]}`}
              aria-label={`界面风格：${themeLabels[theme]}，点击切换为${themeLabels[nextTheme(theme)]}`}
            >
              {themeShortLabel}
              <span>切换为{themeLabels[nextTheme(theme)]}</span>
            </button>
            <button className="btn primary" type="button" onClick={() => setActiveView('ai')}>AI 工作台</button>
          </div>
        </header>
        <TaskPanel compact={activeView === 'writing'} />

        <ErrorBoundary>
          {activeView === 'home' && <DashboardPage />}
          {activeView === 'writing' && <WritingPage />}
          {activeView === 'planning' && <PlanningPage />}
          {activeView === 'pipeline' && <PipelinePage />}
          {activeView === 'ai' && <AiWorkbenchPage />}
          {activeView === 'settings' && <SettingsModelsPage />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

function shortWorkspaceLabel(root: string): string {
  if (!root || root === '未连接工作区') {
    return root || '未连接工作区';
  }
  const parts = root.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}
