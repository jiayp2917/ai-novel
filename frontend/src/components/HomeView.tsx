import { useChapters, useCostDashboard, useHealth, useJobs, useMemoryItems, useSources } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { ActiveView } from '../types';

type ModuleCard = {
  view: ActiveView;
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  metric: string;
};

export function HomeView() {
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const theme = useWorkbenchStore((state) => state.theme);
  const toggleTheme = useWorkbenchStore((state) => state.toggleTheme);
  const health = useHealth();
  const sources = useSources();
  const chapters = useChapters();
  const memory = useMemoryItems();
  const jobs = useJobs();
  const cost = useCostDashboard();
  const workspaceRoot = health.data?.workspace?.root ?? health.data?.content_root ?? '未连接工作区';
  const sourceCount = sources.data?.length ?? 0;
  const chapterCount = chapters.data?.length ?? 0;
  const memoryCount = memory.data?.length ?? 0;
  const runningJobs = cost.data?.running_jobs ?? 0;
  const reviewJobs = jobs.data?.filter((job) => job.type.includes('review')).length ?? 0;

  const modules: ModuleCard[] = [
    {
      view: 'writing',
      eyebrow: '正文',
      title: '正文编写',
      description: '打开章节、阅读正文、创建批注、生成草稿候选。正文区域保持最大化，模型操作不混入主写作区。',
      action: '进入写作台',
      metric: `${chapterCount} 章`,
    },
    {
      view: 'planning',
      eyebrow: '设定 / 章纲',
      title: '设定与章纲',
      description: '查看系统设定、小说设定和章纲，只生成候选提案，不直接覆盖源文件。',
      action: '查看设定章纲',
      metric: `${sources.data?.filter((item) => item.kind !== 'chapters').length ?? 0} 份`,
    },
    {
      view: 'pipeline',
      eyebrow: '流水线',
      title: '自动流水线',
      description: '按章节范围规划生成、审核、修复、复审和发布门流程。当前先作为独立入口，后续接入完整状态机。',
      action: '查看流水线',
      metric: '阶段接入中',
    },
    {
      view: 'review',
      eyebrow: '审核',
      title: '审核中心',
      description: '对候选进行证据约束审核，查看 JSON 问题、owner 分类和阻断原因。',
      action: '进入审核',
      metric: `${reviewJobs} 任务`,
    },
    {
      view: 'fix_publish',
      eyebrow: '修复 / 发布',
      title: '修复发布',
      description: '查看 diff、发布门、备份和写回状态。正式正文只允许通过发布门写回。',
      action: '进入发布门',
      metric: '安全写回',
    },
    {
      view: 'memory',
      eyebrow: '记忆',
      title: '短记忆库',
      description: '重建核心事实、章节卡、上下文预览，减少模型失忆和无效 token 消耗。',
      action: '管理记忆',
      metric: `${memoryCount} 条`,
    },
    {
      view: 'models',
      eyebrow: '模型',
      title: '模型与任务',
      description: '集中查看模型路由、连通性探测、任务队列、调用次数和成本统计。',
      action: '查看模型任务',
      metric: `${cost.data?.today_model_calls ?? 0} 次`,
    },
    {
      view: 'workspace',
      eyebrow: '工作区',
      title: '素材索引',
      description: '切换工作区、扫描素材、识别旧目录和 content 目录布局。',
      action: '管理工作区',
      metric: health.data?.workspace?.layout === 'legacy' ? '旧目录' : '工作区',
    },
  ];

  return (
    <main className="home-view">
      <header className="home-topbar">
        <button className="home-brand" type="button" onClick={() => setActiveView('home')}>
          <span className="home-brand__mark">文</span>
          <span>
            <strong>小说编辑器</strong>
            <small>本地长篇创作、审核与发布工作台</small>
          </span>
        </button>
        <div className="home-status">
          <span className={`health-dot health-dot--${health.isSuccess ? 'success' : health.isError ? 'error' : 'idle'}`} />
          <span>{health.isSuccess ? '后端已连接' : health.isError ? '后端未连接' : '连接检查中'}</span>
          <span>{cost.isSuccess ? `今日调用 ${cost.data.today_model_calls} 次` : '成本统计待加载'}</span>
          <button className="secondary-button" type="button" onClick={toggleTheme}>
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
        </div>
      </header>

      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow">本地长篇小说生产系统</p>
          <h1>把正文编写和大模型调度拆开，按模块推进创作。</h1>
          <p>
            首页只负责选择工作模块。正文写作保持干净，大模型调用、审核、发布、记忆都进入独立面板，
            避免长篇项目在同一个界面里堆满按钮。
          </p>
          <div className="workspace-path">
            <span>当前工作区</span>
            <strong title={workspaceRoot}>{workspaceRoot}</strong>
          </div>
          <div className="home-actions">
            <button className="primary-button" type="button" onClick={() => setActiveView('writing')}>
              开始正文编写
            </button>
            <button className="secondary-button" type="button" onClick={() => setActiveView('models')}>
              查看模型任务
            </button>
          </div>
          <div className="home-stats">
            <span>源文件 {sourceCount}</span>
            <span>正文 {chapterCount}</span>
            <span>记忆 {memoryCount}</span>
            <span>运行任务 {runningJobs}</span>
          </div>
        </div>
        <WorkbenchPreview />
      </section>

      <section className="home-flow" aria-label="安全生产流程">
        <div className="flow-card flow-card--active">
          <span>1</span>
          <strong>生成候选</strong>
          <p>正文、设定和章纲的模型输出先进入候选或提案池。</p>
        </div>
        <div className="flow-card">
          <span>2</span>
          <strong>证据审核</strong>
          <p>审核只给 JSON 诊断，不负责改写或决定发布。</p>
        </div>
        <div className="flow-card">
          <span>3</span>
          <strong>发布门</strong>
          <p>只有正文候选满足审核、diff、备份和 hash 校验后可写回。</p>
        </div>
        <div className="flow-card">
          <span>4</span>
          <strong>更新记忆</strong>
          <p>定稿后更新短记忆，后续模型只读取必要上下文。</p>
        </div>
      </section>

      <section className="module-grid" aria-label="功能模块">
        {modules.map((module) => (
          <button className="module-card" key={module.view} type="button" onClick={() => setActiveView(module.view)}>
            <div className="module-card__top">
              <span>{module.eyebrow}</span>
              <strong>{module.metric}</strong>
            </div>
            <h2>{module.title}</h2>
            <p>{module.description}</p>
            <em>{module.action}</em>
          </button>
        ))}
      </section>

      <section className="home-lower-grid">
        <div className="home-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">最近工作</p>
              <h2>当前项目入口</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => setActiveView('workspace')}>
              管理工作区
            </button>
          </div>
          <div className="home-list">
            <button type="button" onClick={() => setActiveView('writing')}>
              <strong>正文编写</strong>
              <span>{chapterCount} 章可用，右键批注，草稿保存为候选</span>
            </button>
            <button type="button" onClick={() => setActiveView('planning')}>
              <strong>设定/章纲</strong>
              <span>系统设定、小说设定、章纲只进入提案流程</span>
            </button>
          <button type="button" onClick={() => setActiveView('models')}>
            <strong>模型任务</strong>
            <span>集中查看路由、探测、任务队列和 token 统计</span>
          </button>
          <button type="button" onClick={() => setActiveView('pipeline')}>
            <strong>自动流水线</strong>
            <span>规划章节范围生产流程，后续接入无人值守状态机</span>
          </button>
        </div>
      </div>
        <div className="home-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">安全边界</p>
              <h2>当前系统规则</h2>
            </div>
          </div>
          <div className="home-rules">
            <span>正文不直接覆盖源文件</span>
            <span>设定/章纲只生成提案</span>
            <span>模型调用需明确 token 消耗</span>
            <span>发布前必须有候选、审核、备份和 diff</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function WorkbenchPreview() {
  return (
    <div className="workbench-preview" aria-hidden="true">
      <div className="preview-top">
        <span />
        <span />
        <span />
        <strong>Novel Studio</strong>
      </div>
      <div className="preview-body">
        <div className="preview-tree">
          <b>正文卷</b>
          {['001 觉醒天赋', '002 全校等待', '003 老师评语', '004 回家路上'].map((item, index) => (
            <span className={index === 1 ? 'active' : ''} key={item}>{item}</span>
          ))}
        </div>
        <div className="preview-editor">
          <div className="preview-tabs">
            <span>第002章.md</span>
            <span>章纲 01-05.md</span>
          </div>
          <div className="preview-lines">
            {Array.from({ length: 11 }).map((_, index) => (
              <i key={index} style={{ width: `${index % 3 === 0 ? 74 : index % 3 === 1 ? 92 : 58}%` }} />
            ))}
          </div>
        </div>
        <div className="preview-inspector">
          <b>审核</b>
          <span>证据约束</span>
          <span>候选 #128</span>
          <span>发布门通过</span>
        </div>
      </div>
    </div>
  );
}
