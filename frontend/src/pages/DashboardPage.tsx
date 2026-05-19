import { useChapters, useCostDashboard, useSources } from '../hooks';
import { useWorkbenchStore } from '../store';

export function DashboardPage() {
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const sources = useSources();
  const chapters = useChapters();
  const cost = useCostDashboard();
  const sourceCount = sources.data?.length ?? 0;
  const chapterCount = chapters.data?.length ?? 0;

  return (
    <section className="page active">
      <h2 className="page-title">首页工作台</h2>
          <p className="page-subtitle">从写作开始，AI 和自动流水线作为辅助入口。人工草稿可查看改动后确认写回。</p>

      <div className="grid">
        <div className="card metric span-3"><span>源文件</span><b>{sourceCount}</b><span>设定、章纲、正文索引</span></div>
        <div className="card metric span-3"><span>正文</span><b>{chapterCount}</b><span>当前工作区章节数</span></div>
        <div className="card metric span-3"><span>今日调用</span><b>{cost.data?.today_model_calls ?? 0}</b><span>仅本地记录</span></div>
        <div className="card metric span-3"><span>运行任务</span><b>{cost.data?.running_jobs ?? 0}</b><span>后台队列状态</span></div>

        <div className="card span-8">
          <div className="card-head">
            <h2>当前项目</h2>
            <button className="btn" type="button" onClick={() => setActiveView('settings')}>管理作品</button>
          </div>
          <div className="work-row">
            <div className="cover">文</div>
            <div>
              <div className="row-title">当前小说项目</div>
              <div className="muted">支持旧目录：00-系统 / 01-设定 / 02-正文 / 03-章纲</div>
              <div className="chips">
                <span className="chip ok">已接入发布门</span>
                <span className="chip blue">候选池优先</span>
                <span className="chip warn">流水线阶段接入中</span>
              </div>
            </div>
            <button className="btn primary" type="button" onClick={() => setActiveView('writing')}>进入写作</button>
          </div>
          <div className="work-row">
            <div className="cover cover--alt">审</div>
            <div>
              <div className="row-title">AI 辅助与草稿写回</div>
              <div className="muted">AI 草稿先检查，人工草稿可直接查看改动并确认写回。</div>
            </div>
            <button className="btn" type="button" onClick={() => setActiveView('ai')}>打开 AI 工作台</button>
          </div>
        </div>

        <div className="card span-4">
          <div className="card-head"><h2>快捷入口</h2></div>
          <div className="quick">
            <button type="button" onClick={() => setActiveView('writing')}><b>写作</b><span className="muted">编辑正文、保存草稿、查看改动</span></button>
            <button type="button" onClick={() => setActiveView('planning')}><b>资料库</b><span className="muted">设定、章纲、人物与伏笔</span></button>
            <button type="button" onClick={() => setActiveView('ai')}><b>AI 工作台</b><span className="muted">检查、修订、记忆整理与写回</span></button>
            <button type="button" onClick={() => setActiveView('pipeline')}><b>自动流水线</b><span className="muted">批量生成、检查和报告</span></button>
          </div>
        </div>

        <div className="card span-12">
          <div className="card-head">
            <h2>正文安全流</h2>
            <span className="chip warn">禁止模型直接覆盖正文</span>
          </div>
          <div className="flow">
            <div className="flow-step active"><h3>1. 模型生成候选</h3><p className="muted">在独立模型任务页生成，不在正文页直接调用。</p></div>
            <div className="flow-step"><h3>2. 证据审核</h3><p className="muted">审核角色只输出诊断，不修正文。</p></div>
            <div className="flow-step"><h3>3. 写回前检查</h3><p className="muted">标题、版本、改动对比和备份全部校验。</p></div>
            <div className="flow-step"><h3>4. 写回并更新记忆</h3><p className="muted">仅发布门允许写回，之后重建短记忆。</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}
