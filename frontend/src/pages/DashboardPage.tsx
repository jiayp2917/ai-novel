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
      <p className="page-subtitle">聚合素材索引、正文入口、候选审核、模型任务与发布风险，不直接进入正文覆盖操作。</p>

      <div className="grid">
        <div className="card metric span-3"><span>源文件</span><b>{sourceCount}</b><span>设定、章纲、正文索引</span></div>
        <div className="card metric span-3"><span>正文</span><b>{chapterCount}</b><span>当前工作区章节数</span></div>
        <div className="card metric span-3"><span>今日调用</span><b>{cost.data?.today_model_calls ?? 0}</b><span>日志可见下限</span></div>
        <div className="card metric span-3"><span>运行任务</span><b>{cost.data?.running_jobs ?? 0}</b><span>后台队列状态</span></div>

        <div className="card span-8">
          <div className="card-head">
            <h2>当前项目</h2>
            <button className="btn" type="button" onClick={() => setActiveView('workspace')}>进入工作区</button>
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
            <button className="btn primary" type="button" onClick={() => setActiveView('writing')}>继续编写</button>
          </div>
          <div className="work-row">
            <div className="cover cover--alt">审</div>
            <div>
              <div className="row-title">候选审核与发布</div>
              <div className="muted">审核只判断，发布门才允许正文写回。</div>
            </div>
            <button className="btn" type="button" onClick={() => setActiveView('review')}>查看审核</button>
          </div>
        </div>

        <div className="card span-4">
          <div className="card-head"><h2>快捷入口</h2></div>
          <div className="quick">
            <button type="button" onClick={() => setActiveView('writing')}><b>正文编写</b><span className="muted">只编辑草稿，不承接模型调用</span></button>
            <button type="button" onClick={() => setActiveView('models')}><b>模型任务</b><span className="muted">生成候选、提案、审核报告</span></button>
            <button type="button" onClick={() => setActiveView('fix_publish')}><b>修复发布</b><span className="muted">审核通过后进入发布门</span></button>
            <button type="button" onClick={() => setActiveView('memory')}><b>记忆库</b><span className="muted">人物、地点、规则、伏笔</span></button>
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
            <div className="flow-step"><h3>3. 发布门检查</h3><p className="muted">标题、版本、hash、diff、备份全部校验。</p></div>
            <div className="flow-step"><h3>4. 写回并更新记忆</h3><p className="muted">仅发布门允许写回，之后重建短记忆。</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}
