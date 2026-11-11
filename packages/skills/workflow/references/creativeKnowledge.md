# 创作知识库：选材、组合与质量约束

这是可检索的创作参考，不是额外生成引擎，也不是独立 Agent。主 Agent、剧本/分镜、角色、场景和视频导演共用 **`searchVideoPromptTemplates`**：旧 `listTags/search` 保留原有导演镜头模板；新增内容用 `listCreativeTags/searchCreative`，组合前可用 `checkCreativeSelection` 检查冲突。**不能把检索出的多条模板原文串接成最终提示词**。只加载当前镜头需要的 1–3 条。

## 分类与职责

| library | 内容 | 适用阶段 | 不替代 |
| --- | --- | --- | --- |
| `narrative` | 22 套开篇、冲突、揭示、抉择、回报、余波等**剧情节拍** | 剧本、分场和镜头合同 | 具体连续镜头调度 |
| `memes` | 49 条有 2026 年传播记录的网络热梗与二创（含“我超威”） | 经过确认的搞笑/整活剧情 | 完整台词、已授权音轨 |
| `absurd` | 20 套反差喜剧单镜构思 | 喜剧镜头设计 | 角色身份、空间和机械结构 |
| `expressions` | 38 条表情和颜艺：常规、搞怪、极夸张、抽象 | 人物表现与原画 | 角色身份锁及肖像参考 |
| `styles` | 32 种主画风与 16 种滤镜观感 | 项目风格设定、图像/视频外观 | 模型能力、实际 LUT/后期处理 |
| 原有导演模板 | 剧情用途、镜头、动作、运镜、光影、声音与可验证运动 | 视频导演 | 已批准分镜合同及 H3 正式提示词 |

这些属于**不同层级**：叙事结构管“为什么做/情节如何变化”，导演模板管“在这个镜头怎么拍”，表情管“人怎么演”，主画风管“画面是什么美术语言”，滤镜管“在原画风上如何处理颜色与光学观感”，热梗和搞怪只在有创作理由时介入。

## 检索

```ts
// 发现类别：只有这一工具，不要重复注册新的检索工具
searchVideoPromptTemplates({ action:"listCreativeTags" })

// 原导演结构接口保持不变
searchVideoPromptTemplates({ action:"listTags" })
searchVideoPromptTemplates({ action:"search", tags:{scene:["机械变形"]}, limit:2 })

// 按需选 1–3 个匹配项，先确认内容再复制 ID
searchVideoPromptTemplates({ action:"searchCreative", library:"memes", query:"我超威", limit:2 })
searchVideoPromptTemplates({ action:"searchCreative", library:"memes", query:"我 Chovy", limit:2 })
searchVideoPromptTemplates({ action:"searchCreative", library:"narrative", query:"机械展开", limit:2 })
searchVideoPromptTemplates({ action:"searchCreative", library:"expressions", creativeTags:["极夸张表情"], limit:2 })
searchVideoPromptTemplates({ action:"searchCreative", library:"styles", creativeTags:["滤镜"], query:"胶片", limit:2 })

// 模板组合检查：不生成媒体；无权覆盖用户明确指令
searchVideoPromptTemplates({
  action:"checkCreativeSelection",
  medium:"video", tone:"serious", durationSeconds:5,
  selected:{ narrativeId:"n12", expressionId:"e21", styleId:"s01", filterId:"f01" }
})
```

## 与 draftVideoPrompt 的直接衔接

检索工具的 `searchCreative` 返回含稳定 `id` 的匹配模板，外层 Agent 只选择符合当前镜头的少量条目。内置 Agent 在 `draftVideoPrompt.creativeSelection` 传模板 ID，外部 Agent 在 `videoPrompt` 的 `prepare` 操作中传 `input.creativeSelection`。已确认的镜头基调填写在合同的 `tone` 字段。服务端据 ID 取视频摘要并检查冲突，内置导演直接收到摘要，外部 Agent 从 `prepare` 的 `creativeTemplates` 读取摘要。多镜模板留在分镜规划阶段。导演工具内部还会自动使用原 `findVideoPromptTemplates` 候选。无需相关模板时省略 `creativeSelection`。

```ts
// 检索只发生一次，返回的 id 分别为 e02、s01
searchVideoPromptTemplates({action:"searchCreative",library:"expressions",query:"温和微笑",limit:1})
searchVideoPromptTemplates({action:"searchCreative",library:"styles",query:"电影级写实",limit:1})

// 合同与素材输入来自当前已确认的分镜和画布；以下为字段形态示意
draftVideoPrompt({
  shotId:"S01", story:"已确认的镜头动作", purpose:"本镜要交付的信息",
  style:"已批准视觉风格", continuityIn:"从上一镜承接的状态",
  continuityOut:"本镜结束的状态",
  mustHave:["必须出现的第一个事实"], mustNotHave:[],
  intent:"reveal",
  references:[],
  duration:10, ratio:"9:16",
  creativeSelection:{expressionId:"e02",styleId:"s01"}
})
```

上例为**新镜头、无参考的字段示意**，实际必须按 ComfyUI 工作流能力与已连接参考填入对应 `references`；不能用示例假定 Ref2VA 允许无图。对于**已有视频生成节点**，不要传 `duration`、`ratio`、`modelId`、`sampling` 或种子参数；先通过 `node:getConfig` → `node:setConfig` → `node:getPromptContext` 核对，然后将 `node:{canvasId,nodeId,write:true}` 和当前节点实际引用的素材传给 `draftVideoPrompt`。新镜头才必须传数字 `duration` 和字符串 `ratio`。

**宿主兼容要求**：`mustHave`、`mustNotHave`、`references` 必须是 JSON 数组，`templateTags`、`sampling`、`creativeSelection` 为 JSON 对象，`duration` 为数字；不得发送成 `"[]"`、`"{}"` 或 `"10"`。工具现在对外暴露单一对象 Schema，分支互斥由服务器在解析时验证。参数校验失败属于工具调用失败，**不意味着视频已生成，也不应自动重试消耗算力**。

检索支持 `query`、`tags`（多个标签**必须全部匹配**）、`limit`（最多 10 条）和 `library:"all"`。标题与别名优先排序；“我Chovy/我超威”只对应同一条，不重复计数。未命中时不要从记忆编造，应简化标签、减少关键词或改用别的分类。无创作需求不要默认全文检索。

## 一次镜头怎样选模板

1. **确认不可更改事实**：剧情目的、必须出现的动作与对白、人物身份、已批准参考图/工作流、镜头时长、机位和已建立空间关系。没有事实的部分标待确认，不让模板自行补故事。
2. **剧情节拍**：如剧本在前期，则查 `narrative`；`scope:"scene"` 是多镜头场次框架，不能直接压缩到一个 H3 镜头，`scope:"shot"` 才可以作为一个镜头的素材。
3. **导演结构**：先在已有 `search` 里选满足时长、参考模式、主体数、空间锚点的导演模板。只使用对这条镜头有价值的动作和构图；已有导演方案足够好就不额外检索。
4. **表演风格**：挑选最多一个主表情（起点→峰值→收束），一个已批准主画风，最多一个相容滤镜；保留人物五官/衣着与机械尺寸。严肃写实片可以做极夸张的**肌肉与身体反应**，但不能自动卡通换脸、眼球突变。
5. **喜剧节拍**：只有用户要求或剧本合同明确有喜剧时才选 0–1 个热梗/抽象创意。热梗可借用语气、空耳构造和反差原理，尽量重写为原创对白或动作。不要把热门句子塞到任何剧情里。
6. **组合检查**：在决定组合后调用 `checkCreativeSelection`。返回 `invalid` 时不得用错误 ID；返回 `review` 时先处理时长/题材/画风冲突；`ok` 也不等于镜头质量通过。
7. **提示词编译与审核**：把所选模板各抽出**最少必要的可见事实**，经现有 `cinematicPromptCraft`、`h3-prompt-writing` 和独立提示词审核完成最终生成文本。画布使用已有节点 `nodeTools` 设置提示词、参考与执行；不修改画布 JSON，不暗中直出媒体。

## 提示词质量门（每项必须能举证）

| 检查点 | 要检查什么 | 常见坏例 |
| --- | --- | --- |
| 剧情真实 | 本镜头有明确的起点、主要变化、结束状态 | 只写“史诗感、震撼、电影级” |
| 镜头可拍 | 一镜连续、动作与镜头时长匹配 | 5s 内塞进 15s 机械分级展开 |
| 角色一致 | 外貌、服装、语气、音色、编号、参照身份 | “颜艺”使人物长成另一张脸 |
| 空间和接触 | 道具来源、手持、轨道、受力、运动方向 | 机翼突然悬浮，没有铰点 |
| 视觉统一 | 主画风已定，滤镜辅助而非覆盖 | 同镜写实、像素、水墨、黏土并行 |
| 信息密度 | 只有对画面/声音结果有贡献的内容 | 把 4 套完整模板复制到 Prompt |
| 证据边界 | 2026 记录 ≠ 首发时间，IP 二创非官方 | 把 Chovy 空耳说成选手原声 |
| 输出可验收 | 用明确的末态与可观察动作验收 | 只说“好看、感人、有质感” |

**简化示例（影片写实、单镜 5s）：** 旧车车间内，主角发现转轴连接处轻微松动，手持扳手拧紧螺栓，起身观察机翼根部，确认机械臂停止抖动。固定侧前中近景保留主角、扳手与连接点，真实检修灯和金属接触声。这里不需要同时加入十条夸张表情、八种滤镜或流行语。机械变形完整过程必须在合同允许的独立镜头中执行，不能被这个小动作替代。

## 热梗资料边界

- 快照截至 **2026-11-11**。数据来自有日期的媒体盘点或公开词条，包括 [数英 2026-08-21 热词专题](https://www.digitaling.com/articles/1561293.html) 和 [我超威词条](https://www.geng8.com/word/wochaowei.html)。来源字段随每条记录保存。来源与词义需要人工审校；榜单访问数不是全网热度。
- “我超威/我Chovy”是直播喊话的空耳二创，**并非选手 Chovy 本人语录**；原片发布时间和最早空耳创作时间不等于媒体记录时间。已收录词条注明禁用和原创改写建议。
- DeepSeek“蓝色大肥鱼/鲸鱼娘”为社区非官方二创，不应把别人的具体图形设计当成免费商用素材。“嘉豪文学”须避免污名化真实同名者。
- 旧电影、2021 网帖、以前的表情在 2026 年再次传播，只能记为**2026 再传播**，不能标为该年首次创造；不得搬运未授权完整录音、视频、歌词和真人声线。

## 维护

- `apps/server/src/agent/creativeKnowledge/`：数据 `memesCN.ts`、`absurdPrompts.ts`、`expressionTemplates.ts`、`visualStyles.ts`、`narrativeTemplates.ts`，以及数据索引、组合检查和测试。
- `apps/server/src/agent/videoPrompt/templates/`：已有导演模板与唯一分类搜索工具；禁止重复创建检索工具或复写导演节点。
- 新增词条需有稳定 ID、准确来源和日期、适用场景及禁用边界。新增模板需有可执行动作/结构、结果态、适用时长、可验收项及常见失败；优先修质量缺陷，不按数量灌库。
- 变更后必须通过 `bun test src/agent/creativeKnowledge/index.test.ts` 和 GitHub CI 类型检查、生产链路回归测试。程序测试不能替代真实 ComfyUI 的生成 A/B 验证。
