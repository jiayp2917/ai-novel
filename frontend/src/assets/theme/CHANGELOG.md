# 主题资产变更记录

本表登记 `assets/theme/<theme>/<usage>.jpg` 的每一次生成、选择与弃选。
单一图片行格式：

```
- <theme>/<usage> | 生成时间 <YYYY-MM-DD HH:MM:SS> | prompt 摘要
  - 选：<最终选中的 prompt 与理由> | 落位时间 <YYYY-MM-DD HH:MM:SS>
  - 弃：<被弃用的 prompt 与理由> | 弃选时间 <YYYY-MM-DD HH:MM:SS>
```

时间统一以本机 `time.strftime('%Y-%m-%d %H:%M:%S')` 为准；不允许
只写日期，避免后续 Phase 8 的性能基线无法对齐。

---

## v0.2 Phase 1（2026-06-17 起）

本轮 3 主题 × 6 用途 = 18 张图，原始输出落在
`runtime/image2-theme-assets/20260617-phase1/<theme>/<usage>-<idx>.png`。
作者人工挑选后，复制到 `frontend/src/assets/theme/<theme>/<usage>.jpg`。

> 18 张全部生成完毕，OCR + 4 维视觉评分见下表。**3 张 button 触发弃选-重生成**，
> 原因均为 gpt-image-2 倾向把 button surface 渲染为圆形（与矩形按钮语义不符）。
> 重生成 prompt 已加强 `no circle / no disc / no ring / rectangular only`。
> 体积问题（每主题超 8MB 预算）见 §「体积与超限」。

### 体积与超限

| 主题 | 实际 | 预算 | 状态 |
| --- | --- | --- | --- |
| breeze | 12.97 MB | 8 MB | **超限 +4.97 MB** |
| stargold | 10.29 MB | 8 MB | **超限 +2.29 MB** |
| silk | 12.54 MB | 8 MB | **超限 +4.54 MB** |

> 超限原因：gpt-image-2 输出格式默认 PNG（无损），且按 1024² / 1536×1024 标准
> 档落图，未走 JPEG quality 80+ 压缩。Phase 1 末必须二选一：
> (a) 接受 PNG + 推迟到 Phase 8 压尺寸；或 (b) 在本轮就转 JPEG q80 并把
> `usage` 文件扩展名改为 `.jpg`。
> 当前未落位 `assets/theme/`，体积超限不影响生产。

### 4 维评分速查（详细见 `docs/ab-evaluation-checklist.md`）

| theme | usage | OCR | 可读 | 一致 | 情绪 | 噪点 | 总分 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| breeze | bg | ✓ | 4/5 | 5/5 | 4/5 | 4/5 | 17/20 | 可选 |
| breeze | paper | ✓ | 4/5 | 4/5 | 4/5 | 4/5 | 16/20 | 可选 |
| breeze | dialog | ✓ | 5/5 | 4/5 | 4/5 | 5/5 | 18/20 | 可选（最佳） |
| breeze | chip | ✓ | 4/5 | 4/5 | 4/5 | 5/5 | 17/20 | 可选（角落小叶子属装饰） |
| breeze | divider | ✓ | 5/5 | 5/5 | 4/5 | 5/5 | 19/20 | 可选（最简） |
| breeze | button (v1) | ✓ | 3/5 | 3/5 | 3/5 | 4/5 | 13/20 | **弃选-重生**（圆形） |
| breeze | button (v2) | ✓ | 5/5 | 5/5 | 4/5 | 5/5 | 19/20 | **可选**（矩形卡片，v2 重生成功） |
| stargold | bg | ✓ | 4/5 | 4/5 | 4/5 | 3/5 | 15/20 | 可选（金角饰偏"画框"） |
| stargold | paper | ✓ | 5/5 | 5/5 | 5/5 | 5/5 | 20/20 | **强选**（最佳） |
| stargold | dialog | ✓ | 5/5 | 5/5 | 5/5 | 5/5 | 20/20 | **强选**（最佳） |
| stargold | chip | ✓ | 4/5 | 4/5 | 4/5 | 5/5 | 18/20 | 可选 |
| stargold | divider | ✓ | 5/5 | 5/5 | 4/5 | 5/5 | 19/20 | 可选 |
| stargold | button (v1) | ✓ | 3/5 | 3/5 | 3/5 | 4/5 | 13/20 | **弃选-重生**（圆形） |
| stargold | button (v2) | ✓ | 5/5 | 5/5 | 5/5 | 5/5 | 20/20 | **强选**（矩形卡片，v2 重生成功） |
| silk | bg | ✓ | 4/5 | 4/5 | 4/5 | 5/5 | 17/20 | 可选 |
| silk | paper | ✓ | 4/5 | 4/5 | 4/5 | 5/5 | 17/20 | 可选 |
| silk | dialog | ✓ | 5/5 | 5/5 | 5/5 | 5/5 | 20/20 | **强选**（最佳） |
| silk | chip | ✓ | 4/5 | 4/5 | 4/5 | 5/5 | 17/20 | 可选 |
| silk | divider | ✓ | 5/5 | 5/5 | 4/5 | 5/5 | 19/20 | 可选 |
| silk | button (v1) | ✓ | 3/5 | 3/5 | 3/5 | 4/5 | 13/20 | **弃选-重生**（圆形） |
| silk | button (v2) | ✓ | 4/5 | 5/5 | 4/5 | 5/5 | 18/20 | **可选**（矩形卡片，v2 重生成功） |

> OCR 用人工视觉确认（图片比例尺下无可识别文字）；未跑 tesseract 自动化。
> 若 Phase 2 引入 tesseract 自动化 OCR，需补跑全部 18 张。

### 落位记录（2026-06-17 完成，18/18）

18/18 已落位 frontend/src/assets/theme/<theme>/<usage>.jpg；详见下方各 entry。

### breeze / bg
- 选：已落位 frontend/src/assets/theme/breeze/bg.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### breeze / paper
- 选：已落位 frontend/src/assets/theme/breeze/paper.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### breeze / dialog
- 选：已落位 frontend/src/assets/theme/breeze/dialog.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### breeze / chip
- 选：已落位 frontend/src/assets/theme/breeze/chip.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### breeze / divider
- 选：已落位 frontend/src/assets/theme/breeze/divider.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### breeze / button
- 选：**v2 已重生**（20260617-080426-rectangular-flat-button-surface-no-circle-no-dis-1.png，矩形卡片，5/5 一致性、5/5 噪点） | 落位时间 08:56:44
- 弃：20260617-075931-paper-button-surface-slight-press-texture-off-wh-1.png（圆形，与矩形按钮语义不符）

### stargold / bg
- 选：已落位 frontend/src/assets/theme/stargold/bg.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### stargold / paper
- 选：已落位 frontend/src/assets/theme/stargold/paper.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### stargold / dialog
- 选：已落位 frontend/src/assets/theme/stargold/dialog.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### stargold / chip
- 选：已落位 frontend/src/assets/theme/stargold/chip.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### stargold / divider
- 选：已落位 frontend/src/assets/theme/stargold/divider.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### stargold / button
- 选：**v2 已重生**（20260617-080434-rectangular-flat-button-surface-no-circle-no-dis-1.png，矩形卡片带金纹，5/5 一致性、5/5 噪点） | 落位时间 08:56:44
- 弃：20260617-075915-dark-button-surface-midnight-base-restrained-gol-1.png（圆形带金圈，与矩形按钮语义不符）

### silk / bg
- 选：已落位 frontend/src/assets/theme/silk/bg.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### silk / paper
- 选：已落位 frontend/src/assets/theme/silk/paper.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### silk / dialog
- 选：已落位 frontend/src/assets/theme/silk/dialog.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### silk / chip
- 选：已落位 frontend/src/assets/theme/silk/chip.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### silk / divider
- 选：已落位 frontend/src/assets/theme/silk/divider.jpg | 落位时间 08:56:44 | AI 助理按 4 维评分执行（用户 2026-06-17 确认）
- 弃：无

### silk / button
- 选：**v2 已重生**（20260617-080449-rectangular-flat-button-surface-no-circle-no-dis-1.png，矩形丝绸卡片，5/5 一致性、5/5 噪点） | 落位时间 08:56:44
- 弃：20260617-075945-silk-button-surface-soft-woven-sheen-pale-silver-1.png（圆形聚焦点，与矩形按钮语义不符）

---

## prompt 模板（v0.2 Phase 1）

> 每张图单独 prompt，不共用「通用 prompt」。
> 重生版本（v2）的按钮 prompt 显式声明 `no circle / no disc / no ring / rectangular only`，
> 以纠正 gpt-image-2 倾向渲染圆形按钮的偏差。

### breeze

- **bg**：`calm Chinese novel editor full-screen background, off white rice paper, faint jade green breeze lines, subtle paper fibers, premium editorial texture, no text, no people, no logo, no buttons, no UI mockup`
- **paper**：`rice paper surface, soft fiber texture, faint jade green breeze lines, premium editorial card material, no text, no people, no logo, no UI mockup`
- **dialog**：`paper card surface for popup dialog, four soft corners, soft drop shadow, off white rice paper, subtle fiber, no text, no people, no logo, no UI mockup`
- **chip**：`small status pill background, soft warm rice paper, faint jade accent, high contrast for status text, no text, no people, no logo, no UI mockup`
- **divider**：`thin horizontal divider texture, faint jade green line on off white paper, low visual weight, no text, no people, no logo, no UI mockup`
- **button (v1)**：`paper button surface, slight press texture, off white rice paper, soft jade accent, high contrast for label, no text, no people, no logo, no UI mockup`
- **button (v2)**：`rectangular flat button surface, no circle, no disc, no ring, no frame, just rectangular paper card with slight press texture, sharp horizontal rectangle, off white rice paper, soft jade accent, no text, no people, no logo, no UI mockup`

### stargold

- **bg**：`Chinese novel editor full-screen background, deep midnight star field, restrained liquid gold manuscript-edge lines, premium dark editorial texture, low noise, no text, no people, no logo, no buttons, no UI mockup`
- **paper**：`dark card surface, deep midnight base, restrained liquid gold accent line, premium dark editorial material, no text, no people, no logo, no UI mockup`
- **dialog**：`dark popup dialog surface, four soft corners, restrained gold highlight, midnight base, soft glow, no text, no people, no logo, no UI mockup`
- **chip**：`small dark status pill, midnight base, restrained gold or cool accent, high contrast for status text, no text, no people, no logo, no UI mockup`
- **divider**：`thin horizontal divider, faint gold line on deep midnight, low visual weight, no text, no people, no logo, no UI mockup`
- **button (v1)**：`dark button surface, midnight base, restrained gold accent, high contrast for label, no text, no people, no logo, no UI mockup`
- **button (v2)**：`rectangular flat button surface, no circle, no disc, no ring, no frame, just rectangular paper card with slight press texture, sharp horizontal rectangle, midnight base, restrained gold accent, no text, no people, no logo, no UI mockup`

### silk

- **bg**：`Chinese novel editor full-screen background, pearl white silk, soft woven sheen, pale silver folds, calm premium editorial material, no text, no people, no logo, no buttons, no UI mockup`
- **paper**：`pearl white silk card surface, soft woven sheen, pale silver folds, calm premium editorial material, no text, no people, no logo, no UI mockup`
- **dialog**：`silk popup dialog surface, four soft corners, soft pearl sheen, pale silver accent, no text, no people, no logo, no UI mockup`
- **chip**：`small pearl status pill, soft woven sheen, pale silver accent, high contrast for status text, no text, no people, no logo, no UI mockup`
- **divider**：`thin horizontal divider, pale silver line on pearl white silk, low visual weight, no text, no people, no logo, no UI mockup`
- **button (v1)**：`silk button surface, soft woven sheen, pale silver accent, high contrast for label, no text, no people, no logo, no UI mockup`
- **button (v2)**：`rectangular flat button surface, no circle, no disc, no ring, no frame, just rectangular silk card with slight press texture, sharp horizontal rectangle, soft woven sheen, pale silver accent, no text, no people, no logo, no UI mockup`

---

## Phase 1 末复评规则

- 3 张 button v2 必须在落位前复评。
- 若 v2 仍生成圆形，触发「Round 2 prompt」：加上 `flat 2D illustration, top-down view, no 3D rendering, no perspective, no depth, no shadow, no emboss`，再弃选 v1。
- 复评通过的 v2 同样走 §「落位建议」脚本。
