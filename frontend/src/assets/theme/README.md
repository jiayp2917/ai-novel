# 主题视觉资产说明

本目录保存前端主题使用的本地视觉素材。素材只作为界面背景、纸张质感和主题氛围层，不承载产品文案、按钮、人物、真实作品内容或密钥信息。

## 当前资产

- `theme-breeze.jpg`：主题 1「清风稿纸」，以米白稿纸、浅绿风线和纸纤维为主，作为默认写作与出版编辑台底材。
- `theme-stargold.jpg`：主题 2「星空鎏金」，以深夜星空、克制金线和手稿边缘质感为主，作为高对比深色主题底材。
- `theme-silk.jpg`：主题 3「白丝质感」，以珍珠白丝绸、银灰褶皱和低饱和光泽为主，作为轻奢浅色主题底材。

## 生成记录

- 生成工具：本地 `image2-generate` Skill。
- 模型：`gpt-image-2`。
- 可用端点：`/v1/responses` + `image_generation`。
- 生成时间：2026-06-15。
- 原始输出目录：`runtime/image2-theme-assets/20260615-111858/`。

## 生成提示词摘要

### 主题 1：清风稿纸

```text
Chinese novel editor background, calm publishing desk, off white rice paper,
faint jade green breeze lines, subtle paper fibers, premium editorial texture,
no text, no people, no logo, no buttons, no UI mockup
```

### 主题 2：星空鎏金

```text
Chinese novel editor background, deep midnight star field, restrained liquid
gold manuscript-edge lines, premium dark editorial texture, low noise,
no text, no people, no logo, no buttons, no UI mockup
```

### 主题 3：白丝质感

```text
Chinese novel editor background, pearl white silk texture, soft woven sheen,
pale silver folds, calm premium editorial material, no text, no people,
no logo, no buttons, no UI mockup
```

## 使用边界

- 不在素材中放置可读文字，避免与中文优先原则和界面文案维护冲突。
- 不把 API key、代理地址、真实作品正文或本机私密路径写入素材说明。
- 如果后续重生成主题图，应先放入 `runtime/` 进行人工挑选，再复制确认采用的文件到本目录。
