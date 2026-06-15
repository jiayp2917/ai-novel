import { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bot, Cpu, Home, LibraryBig, PenLine, Settings, Workflow } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TaskPanel } from './components/TaskPanel';
import { useHealth } from './hooks';
import { DashboardPage } from './pages/DashboardPage';
import { AiWorkbenchPage, ModelsPage, PipelinePage, PlanningPage, SettingsPage, WritingPage } from './pages/CorePages';
import { useWorkbenchStore } from './store';
import { nextTheme, themeLabels, themeShortLabels } from './theme';
import type { ActiveView } from './types';

const navItems: Array<{ id: ActiveView; icon: LucideIcon; label: string }> = [
  { id: 'home', icon: Home, label: '首页' },
  { id: 'writing', icon: PenLine, label: '写作' },
  { id: 'planning', icon: LibraryBig, label: 'AI 素材库' },
  { id: 'ai', icon: Bot, label: 'AI 工作台' },
  { id: 'pipeline', icon: Workflow, label: '自动流水线' },
];

const shortNavLabels: Record<ActiveView, string> = {
  home: '首页',
  writing: '写作',
  planning: '素材',
  ai: 'AI',
  pipeline: '流水线',
  settings: '设置',
  models: '模型',
};

const viewTitles: Record<ActiveView, string> = {
  home: '首页工作台',
  writing: '写作',
  planning: 'AI 素材库',
  pipeline: '自动流水线',
  ai: 'AI 工作台',
  settings: '设置',
  models: '模型配置',
};

export function App() {
  const activeView = useWorkbenchStore((state) => state.activeView);
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const theme = useWorkbenchStore((state) => state.theme);
  const toggleTheme = useWorkbenchStore((state) => state.toggleTheme);
  const health = useHealth();
  const workspaceRoot = health.data?.workspace?.root ?? health.data?.content_root ?? '未连接工作区';
  const workspaceLabel = shortWorkspaceLabel(workspaceRoot);
  const nextThemeMode = nextTheme(theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app prototype-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className="sidebar">
        <div className="brand">
          <h1>小说编辑器</h1>
          <p>长篇写作台</p>
        </div>
        <nav className="nav" aria-label="主导航">
          {navItems.map((item) => (
            <NavIconButton
              active={item.id === activeView}
              icon={item.icon}
              key={item.id}
              label={item.label}
              shortLabel={shortNavLabels[item.id]}
              onClick={() => setActiveView(item.id)}
            />
          ))}
        </nav>
        <NavIconButton
          active={activeView === 'models'}
          className="sidebar-settings"
          icon={Cpu}
          label="模型配置"
          shortLabel="模型"
          onClick={() => setActiveView('models')}
        />
        <NavIconButton
          active={activeView === 'settings'}
          className="sidebar-settings"
          icon={Settings}
          label="设置"
          shortLabel="设置"
          onClick={() => setActiveView('settings')}
        />
      </aside>

      <main className="main" id="main-content" tabIndex={-1}>
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
            <button
              className="btn theme-switch theme-switch--compact"
              type="button"
              onClick={toggleTheme}
              title={`当前：${themeLabels[theme]}，点击切换为${themeLabels[nextThemeMode]}`}
              aria-label={`界面风格：${themeLabels[theme]}，点击切换为${themeLabels[nextThemeMode]}`}
            >
              {themeShortLabels[theme]}
              <span>切换为{themeLabels[nextThemeMode]}</span>
            </button>
          </div>
        </header>
        <TaskPanel compact={activeView === 'writing'} />

        <ErrorBoundary>
          {activeView === 'home' && <DashboardPage />}
          {activeView === 'writing' && <WritingPage />}
          {activeView === 'planning' && <PlanningPage />}
          {activeView === 'pipeline' && <PipelinePage />}
          {activeView === 'ai' && <AiWorkbenchPage />}
          {activeView === 'settings' && <SettingsPage />}
          {activeView === 'models' && <ModelsPage />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

type NavIconButtonProps = {
  active: boolean;
  className?: string;
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  onClick: () => void;
};

function NavIconButton({ active, className, icon: Icon, label, shortLabel, onClick }: NavIconButtonProps) {
  const classes = [className ?? '', active ? 'active' : ''].filter(Boolean).join(' ');

  return (
    <button
      className={classes}
      type="button"
      title={label}
      aria-label={`打开${label}`}
      onClick={onClick}
    >
      <span className="ico" aria-hidden="true">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <span>{label}</span>
      <small className="nav-short-label" aria-hidden="true">{shortLabel}</small>
    </button>
  );
}

function shortWorkspaceLabel(root: string): string {
  if (!root || root === '未连接工作区') {
    return root || '未连接工作区';
  }
  const parts = root.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}
