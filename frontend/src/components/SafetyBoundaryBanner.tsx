export function SafetyBoundaryBanner({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? 'safety-banner safety-banner--compact' : 'safety-banner'}>
      <div>
        <p className="eyebrow">安全边界</p>
        <strong>所有模型输出先进入候选或提案，正文写回只能经过发布门。</strong>
      </div>
      <div className="safety-banner__rules">
        <span>审核只判断</span>
        <span>设定/章纲只提案</span>
        <span>写回前校验版本、改动对比和备份</span>
      </div>
    </section>
  );
}
