# 提示词审核（文生图 / 文生视频）

专职只审核已写成的合同，不改写 prompt、不改 lock、不改 Picture 槽位、不生成、不宣布批准。文生图工与文生视频工禁止混审。

## 文生图（character / scene / prop-prompt-review）

### 文生图输入（缺一则 blocked）
- 当前对话或剧本画布里的本章原文（不要一次读全书）
- 系统提示中的 `production.image` 与 `production_profile`
- 资产规划项：canonical_description、required_state、allowed_variant_changes、evidence
- 资产画布上该资产的登记
- 原画专职刚输出的完整 canonical_art 合同
- 本技能 references 里的 `common.md` 与对应原画说明（character-art / scene-art / prop-art）

### 文生图审核顺序
1. 对照原文：身份、外形、空间、结构、数量、位置关系是否与小说已写明的事实一致；有无跑题或把别的实体写进本张。
2. 对照规划：required_state 必须能在画面里成立；allowed_variant_changes 不得画进 canonical；不得把未确认属性写成已锁定事实。
3. 对照制作规则：画幅与类型匹配；正面 `prompt` 正文应为英文（以拉丁词为主）；若正文以汉字为主，判不合格并要求改写成英文。须另有非空 `prompt_zh` 简体中文对照（给人审阅，不进模型）。页脚 `Visual Style:` / `Still:` 由 sidecar 追加，不要求出现在专职 prompt 里；正面 prompt 无否定写法；Qwen 和带负面节点的其他 Comfy 原画工作流，禁忌只在 negative_constraints 且写成不想要的画面事实；Flux.3 Klein 工作流按 `common.md`「Flux.3 Klein 出图」，negative_constraints 必须为 []，替代事实必须在正面 prompt，非空负面判不合格；锁写进 prompt 正文；review_checklist 5–8 条且都是本张能看见的正向事实；类比尺寸写法、空词堆砌判不合格。文字详略见 [common.md](common.md#写法克制)。另检：施工清单式堆砌或空词「有体积光/有纵深感」；否定/排除词入正面（`image/flux3KleinEdit` 与 `image/flux3KleinDistilledEdit` 的 `Remove the …` 编辑指令除外，须同时写出改完后的可见状态）；多格是否逐格正向（禁「其余格不要」）；有负面节点时，全图 negative 是否误伤只在某一格需要的元素。Flux.3 Klein 不检负面名单。见 `common.md`「写法克制」「原画正负面与多格」「Flux.3 Klein 出图」。
3b. 场景合同须有可核对的命名锚点（非纯氛围形容词）；道具合同须有可核对的尺度表述（手持/桌面/家具或等价）。空景无人、白底无手已有规则仍检。
4. 尚待设计的普通细节允许原画提出方案，不因此退回。原文已确认的事实被改写、编造或删掉则退回。

### 文生图输出与交接
只返回 `art_prompt_review`。合格：status=ok，findings 必须 []。不合格：status=rejected，findings 含整改意见。缺原文或关键设定：公共 blocked。总控把 rejected 退回对应原画专职；status=ok 后把 art 与 review 写入当前画布的文本节点。不要调用 `/assets/prompt`、sidecar 或 SQLite。

## 文生视频（video-prompt-review）

成片导演合同交给 [video-prompt-review.md](video-prompt-review.md)。该专职按自身输入要求和审核规则返回 `video_prompt_review`。
