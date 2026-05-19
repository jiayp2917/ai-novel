import type { ModelUsageReport } from '../types';
import { chapterLabel, percent, roleLabel, taskTypeLabel } from './modelViewUtils';

export function QualityTrendSection({ report, isLoading }: { report?: ModelUsageReport; isLoading: boolean }) {
  const reviewer = report?.role_quality.reviewer;
  const writer = report?.role_quality.writer;
  const fixer = report?.role_quality.fixer;

  return (
    <section className="workflow-card">
      <div className="section-title">
        <div>
          <p className="eyebrow">质量趋势</p>
          <h2>AI 检查、写作和修订是否稳定</h2>
        </div>
        <span className="quality-note">{report?.usage_note ?? '本地统计为日志可见下限。'}</span>
      </div>
      {isLoading && <p className="muted">正在整理模型质量数据...</p>}
      {!isLoading && (
        <div className="quality-grid">
          <article className="quality-card">
            <span>AI 检查</span>
            <strong>{reviewer?.insufficient_data ? '数据不足' : percent(reviewer?.evidence_rate)}</strong>
            <p>证据率。无证据问题 {reviewer?.no_evidence_issues ?? 0} 条，需人工判断 {reviewer?.manual_required ?? 0} 次。</p>
            <details className="advanced-details">
              <summary>检查详情</summary>
              <div className="quality-detail-grid">
                <small>检查次数：{reviewer?.reviews ?? 0}</small>
                <small>通过：{reviewer?.passed ?? 0}</small>
                <small>问题总数：{reviewer?.issues ?? 0}</small>
                <small>JSON 解析失败：{reviewer?.json_parse_failed ?? 0}</small>
              </div>
            </details>
          </article>
          <article className="quality-card">
            <span>AI 写作</span>
            <strong>{writer?.insufficient_data ? '数据不足' : percent(writer?.word_count_pass_rate)}</strong>
            <p>
              字数达标率。目标 {writer?.target_min ?? 2000}-{writer?.target_max ?? 2600} 字，
              允许 {writer?.hard_min ?? 1900}-{writer?.hard_max ?? 2700} 字。
            </p>
            <details className="advanced-details">
              <summary>草稿详情</summary>
              <div className="quality-detail-grid">
                <small>草稿：{writer?.candidate_count ?? 0}</small>
                <small>达标：{writer?.word_count_passed ?? 0}</small>
                <small>过短：{writer?.too_short ?? 0}</small>
                <small>过长：{writer?.too_long ?? 0}</small>
                <small>数据不足：{writer?.unknown_count ?? 0}</small>
              </div>
            </details>
          </article>
          <article className="quality-card">
            <span>AI 修订</span>
            <strong>{fixer?.insufficient_data ? '数据不足' : percent(fixer?.rereview_pass_rate)}</strong>
            <p>复审通过率。等待复审 {fixer?.waiting_review ?? 0} 个，无法归因 {fixer?.unknown_count ?? 0} 个。</p>
            <details className="advanced-details">
              <summary>修订详情</summary>
              <div className="quality-detail-grid">
                <small>修订草稿：{fixer?.fixed_candidate_count ?? 0}</small>
                <small>已复审：{fixer?.reviewed_count ?? 0}</small>
                <small>通过：{fixer?.passed ?? 0}</small>
                <small>未通过：{fixer?.failed ?? 0}</small>
              </div>
            </details>
          </article>
        </div>
      )}
      {!!report?.recommendations.length && (
        <div className="quality-recommendations">
          {report.recommendations.map((item) => <span key={item}>{item}</span>)}
        </div>
      )}
    </section>
  );
}

export function RoleUsageSection({ report, isLoading }: { report?: ModelUsageReport; isLoading: boolean }) {
  const rows = report?.role_usage ?? [];
  return (
    <section className="workflow-card">
      <div className="section-title">
        <div>
          <p className="eyebrow">按分工统计</p>
          <h2>各类 AI 助手的调用稳定性</h2>
        </div>
        <span className="quality-note">用量为本地可见下限</span>
      </div>
      {isLoading && <p className="muted">正在统计各分工调用情况...</p>}
      {!isLoading && !rows.length && <p className="muted">数据不足。运行 AI 检查、写作或修订后，这里会显示成功率、耗时和用量。</p>}
      {!!rows.length && (
        <div className="observability-table" role="table" aria-label="按分工统计">
          <div className="observability-row observability-row--head" role="row">
            <span>分工</span>
            <span>AI</span>
            <span>调用</span>
            <span>成功率</span>
            <span>平均耗时</span>
            <span>本地用量</span>
            <span>缓存</span>
          </div>
          {rows.map((row) => (
            <div className="observability-row" role="row" key={`${row.role}-${row.provider}-${row.model}`}>
              <span>{roleLabel(row.role)}</span>
              <span>{row.provider}/{row.model}</span>
              <span>{row.calls}</span>
              <span>{percent(row.success_rate)}</span>
              <span>{row.avg_elapsed_seconds.toFixed(2)} 秒</span>
              <span>{Math.round(row.provider_tokens || row.estimated_million_tokens * 1_000_000)}</span>
              <span>{row.cache_hits}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ContextBudgetSection({ report, isLoading }: { report?: ModelUsageReport; isLoading: boolean }) {
  const records = report?.context_budget.affected_chapters ?? [];
  return (
    <section className="workflow-card">
      <div className="section-title">
        <div>
          <p className="eyebrow">上下文预算提示</p>
          <h2>哪些章节发生过上下文裁剪</h2>
        </div>
        <span className="quality-note">
          已记录 {report?.context_budget.context_reports ?? 0} 次上下文报告，裁剪 {report?.context_budget.degraded_count ?? 0} 次
        </span>
      </div>
      {isLoading && <p className="muted">正在检查上下文预算...</p>}
      {!isLoading && !records.length && <p className="muted">暂无上下文裁剪。</p>}
      {!!records.length && (
        <div className="context-budget-list">
          {records.map((record) => (
            <article className="context-budget-card" key={`${record.artifact_id}-${record.task_type}`}>
              <div>
                <strong>{chapterLabel(record)}</strong>
                <span>{taskTypeLabel(record.task_type)}</span>
              </div>
              <p>{record.reason}</p>
              <div className="context-budget-meta">
                <small>预算：{record.budget ?? '-'} 字符</small>
                <small>实际输入：{record.input_chars ?? '-'} 字符</small>
              </div>
              <details className="advanced-details">
                <summary>查看保留和裁剪片段</summary>
                <div className="section-chip-list">
                  <strong>已保留</strong>
                  {record.selected_sections.length
                    ? record.selected_sections.map((section) => <span key={`selected-${section.name}`}>{section.name}：{section.chars}</span>)
                    : <span>无记录</span>}
                </div>
                <div className="section-chip-list">
                  <strong>已裁剪</strong>
                  {record.dropped_sections.length
                    ? record.dropped_sections.map((section) => <span key={`dropped-${section.name}`}>{section.name}：{section.chars}</span>)
                    : <span>无记录</span>}
                </div>
                <div className="section-chip-list">
                  <strong>高级</strong>
                  <span>产物：#{record.artifact_id}</span>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
