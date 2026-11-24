# 提示词审核（文生图 / 文生视频）

审核员只审核已经编写完成的合同，不改写 prompt、不改 lock、不改 Picture 槽位、不生成、不宣布批准。文生图提示词审核员与文生视频提示词审核员不得混合承担两种审核任务。

## 文生图（character / scene / prop-prompt-review）

### 文生图输入（缺一则 blocked）
- 当前对话或剧本画布里的本章原文（不要一次读全书）
- 系统提示中的 `production.image` 与 `production_profile`
- 资产规划项：canonical_description、required_state、allowed_variant_changes、evidence
- 资产画布上该资产的登记
- 原画提示词编写人员刚刚提交的完整 canonical_art 合同
- 本技能 references 里的 `common.md` 与对应原画说明（character-art / scene-art / prop-art）

### 文生图审核顺序
1. 对照原文：身份、外形、空间、结构、数量、位置关系是否与小说已写明的事实一致；是否偏离原文，或将其他实体误写入这张图片。
2. 对照规划：required_state 必须能在画面里成立；allowed_variant_changes 不得画进 canonical；不得把未确认属性写成已锁定事实。
3. 对照 [公共原画规则](common.md#原画正负面与多格)核对工作流和实际负面条件。无负面能力时 `negative_constraints` 填空数组；有底图时根据编辑规则核对改动和保留项。正文按实际模型语言，`prompt_zh` 用通顺的简体中文对照。画幅按资产用途，保留本图中必须保持一致的身份特征和结构，`review_checklist` 填 5–8 条实际能看到的事实。多格逐格核对可见内容，避免用全图负面条件删除某格需要的元素。
3b. 场景合同须有可核对的命名锚点（非纯氛围形容词）；道具合同须有可核对的尺度表述（手持/桌面/家具或等价）。仍须核对场景图中没有人物，以及要求白色背景的原画中不出现手部等既有规则。
3c. 编辑任务按[图像编辑规则](common.md#图像编辑与变体)核对实际底图、视角、改动和保留项。方向与终点以图中固定部件为准。更换视角时，检查原有身份特征在该角度是否可见。上轮输出未看过、未通过时，不能作为下一次编辑的合格底图。
4. 尚待设计的普通细节允许原画提出方案，不因此退回。原文已确认的事实被改写、编造或删掉则退回。

### 文生图输出与交接
只返回 `art_prompt_review`。合格：status=ok，findings 必须 []。不合格：status=rejected，findings 含整改意见。缺原文或关键设定：公共 blocked。负责统筹制作的 Agent 将未通过审核的稿件交回相应的原画提示词编写人员；status=ok 后把 art 与 review 写入当前画布的文本节点。不要调用 `/assets/prompt`、sidecar 或 SQLite。

## 文生视频（video-prompt-review）

成片导演合同交给 [video-prompt-review.md](video-prompt-review.md)。具体审核提交方式及写回规则见[提交与交接](video-prompt-review.md#提交与交接)。
