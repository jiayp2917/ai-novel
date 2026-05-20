import { useCostDashboard, useHealth } from '../hooks';
import { useWorkbenchStore } from '../store';
import { nextTheme, themeLabels } from '../theme';

export function TopBar() {
  const health = useHealth();
  const cost = useCostDashboard();
  const theme = useWorkbenchStore((state) => state.theme);
  const toggleTheme = useWorkbenchStore((state) => state.toggleTheme);
  const activeView = useWorkbenchStore((state) => state.activeView);
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);

  const workspaceRoot = health.data?.workspace?.root ?? health.data?.content_root ?? '未连接工作区';

  return (
    <header className="top-bar">
      <button className="brand-block brand-block--button" type="button" onClick={() => setActiveView('home')}>
        <div className="brand-mark">文</div>
        <div>
          <strong>小说编辑器</strong>
          <span>长篇创作、审核与发布工作台</span>
        </div>
      </button>
      <div className="command-center">
        <span>{activeViewLabel(activeView)}</span>
        <strong>{workspaceRoot}</strong>
      </div>
      <div className="top-metrics">
        <span className={`health-dot health-dot--${health.isSuccess ? 'success' : health.isError ? 'error' : 'idle'}`} />
        <span>{health.isSuccess ? '后端已连接' : health.isError ? '后端未连接' : '连接检查中'}</span>
        <span>{cost.isSuccess ? `今日调用 ${cost.data.today_model_calls} 次` : '成本统计待加载'}</span>
        <button className="secondary-button theme-switch theme-switch--compact" type="button" onClick={toggleTheme} title={`当前：${themeLabels[theme]}，点击切换为${themeLabels[nextTheme(theme)]}`}>
          界面风格：{themeLabels[theme]}
          <span>切换为{themeLabels[nextTheme(theme)]}</span>
        </button>
      </div>
    </header>
  );
}

function activeViewLabel(view: string) {
  const labels: Record<string, string> = {
    home: '首页工作台',
    writing: '写作',
    planning: '资料库',
    ai: 'AI 工作台',
    pipeline: '自动流水线',
    settings: '设置/模型',
  };
  return labels[view] ?? '工作台';
}
