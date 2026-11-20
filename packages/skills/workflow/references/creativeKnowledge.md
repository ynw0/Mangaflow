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

检索工具的 `searchCreative` 返回带稳定 `id` 的条目。内置 Agent 在 `draftVideoPrompt.creativeSelection` 传模板 ID，外部 Agent 在 `videoPrompt` 的 `prepare` 中传 `input.creativeSelection`。镜头基调按已确认合同填写 `tone`。两条路径使用同一份制作摘要。叙事和喜剧条目的具体事件在构思分镜时使用，热梗原话如需入片也在定稿阶段确认。成片写作从已确认的分镜取事件、切点和原话。

内置导演的拍法候选来自 `draftVideoPrompt.templateTags`。有具体拍摄问题时传对应标签，已有拍法时可省略；仅传 `intent` 会选择适用的导演资料。外部 Agent 需要拍法时使用 `searchVideoPromptTemplates` 的 `search`。

```ts
// 检索只发生一次，返回的 id 分别为 e02、s01
searchVideoPromptTemplates({action:"searchCreative",library:"expressions",query:"温和微笑",limit:1})
searchVideoPromptTemplates({action:"searchCreative",library:"styles",query:"电影级写实",limit:1})

// 合同与素材输入来自当前已确认的分镜和画布；以下为字段形态示意
draftVideoPrompt({
  shotId:"S01", story:"已确认的镜头动作", lockedDialogue:[], purpose:"本镜要交付的信息",
  style:"已批准视觉风格", continuityIn:"从上一镜承接的状态",
  continuityOut:"本镜结束的状态",
  mustHave:["必须出现的第一个事实"], mustNotHave:[],
  intent:"reveal",
  references:[],
  duration:10, ratio:"9:16",
  creativeSelection:{expressionId:"e02",styleId:"s01"}
})
```

上例演示新镜头参数。参考素材按实际工作流和槽位填写，新镜头的 `duration` 和 `ratio` 为必填项。

已有视频生成节点时，先用 `node:getConfig` 核对配置，有需调整的参数才用 `node:setConfig`，然后读取 `node:getPromptContext`。顶层仍填写原合同的 `shotId`、剧情和实际参考。画布和节点 ID 放在 `node` 对象内，个别生成参数从节点读取。下面的值仅用于演示结构，调用时用已确认的镜头合同和实际素材替换。

```json
{
  "shotId": "EP001-S11b",
  "story": "陆明确认屏幕上的警报后抬头。",
  "lockedDialogue": [],
  "purpose": "交代陆明发现异常",
  "style": "写实工业科幻",
  "continuityIn": "陆明坐在工作台前",
  "continuityOut": "陆明抬头看向门口",
  "mustHave": ["陆明停手后抬头"],
  "mustNotHave": [],
  "intent": "reveal",
  "references": [
    {
      "path": "素材/陆明.png",
      "kind": "image",
      "purpose": "角色身份参考",
      "description": "陆明的脸部与服装参考"
    }
  ],
  "node": {
    "canvasId": "EP001.json",
    "nodeId": "实际视频节点ID",
    "write": true
  }
}
```

- 已有节点时省略顶层 `canvasId`、`modelId`、`duration`、`ratio`、`sampling`、`seed` 和 `seedMode`。
- 首次 `draftVideoPrompt` 调用未通过入参校验时，按报错修正当前调用。缺 `shotId` 时补原合同编号，多传顶层 `canvasId` 时移除它并保留 `node.canvasId`。此阶段没有该次调用生成的待审稿。
- 返回 `reviewFailed` 且包含 `draftId` 时，按 `nextAction` 调用 `resumeVideoPrompt` 重审原稿。返回 `rejected` 且包含 `draftId` 时，按 `nextAction` 使用原合同和整改意见定向返修。剧本或分镜版本改变后用更新后的合同重新提交。中断后遗失编号，可在原会话用 `resumeVideoPrompt({shotId})` 查询，同一镜头有多份稿时选对应的 `draftId`。用户要求修改本镜的提示词、拍法或表演时，传 `regenerate: true`，按当前合同写新稿。仅修改生成参数时复用已审稿。
- 外部 MCP 调用 `videoPrompt`。将上述合同放进 `args.input`，并在 `args.action` 传 `prepare`。随后用返回的 `preparationId` 和当前导演稿执行 `inspect`，以审核结果和同一份稿执行 `submit`。审核结构、写回与交接见[视频审核规则](video-prompt-review.md#提交与交接)。

**宿主兼容要求**：`mustHave`、`mustNotHave`、`references` 必须是 JSON 数组，`templateTags`、`sampling`、`creativeSelection` 为 JSON 对象，`duration` 为数字；不得发送成 `"[]"`、`"{}"` 或 `"10"`。工具现在对外暴露单一对象 Schema，分支互斥由服务器在解析时验证。参数校验失败属于工具调用失败，**不意味着视频已生成，也不应自动重试消耗算力**。

检索支持 `query`、`tags`（多个标签**必须全部匹配**）、`limit`（最多 10 条）和 `library:"all"`。标题与别名优先排序；“我Chovy/我超威”只对应同一条，不重复计数。未命中时不要从记忆编造，应简化标签、减少关键词或改用别的分类。无创作需求不要默认全文检索。

## 一次镜头怎样选模板

1. **确认不可更改事实**：剧情目的、必须出现的动作与对白、人物身份、已批准参考图/工作流、镜头时长、机位和已建立空间关系。没有事实的部分标待确认，不让模板自行补故事。
2. **剧情节拍**：如剧本在前期，则查 `narrative`；`scope:"scene"` 是多镜头场次框架：在用户允许剪辑且片段时长足够时，可拆为同一个 H3 视频片段内的多个 `[Shot N]`，并逐镜规划切点；不得直接粘贴完整场次或偷删剧情。用户明确要求单镜时仍只能规划一个连续摄影镜头；`scope:"shot"` 是单个镜头的素材，不代表一个视频节点只能一个镜头。
3. **导演结构**：先在已有 `search` 里选满足时长、参考模式、主体数、空间锚点的导演模板。只使用对这条镜头有价值的动作和构图；已有导演方案足够好就不额外检索。
4. **表演与画风**：表情条目提供可选的脸部细节和强度。取用前先判断人物此刻在做什么、因何反应。夸张或机械化的表演适用于剧本确有喜剧、卡通或机械动作的地方。画风和滤镜只提供视觉参考，景别、机位和剪辑由已确认的分镜决定。保留人物五官、衣着和道具结构。
5. **喜剧节拍**：剧情有喜剧空间时，可按角色和节奏选 0–1 个热梗或抽象创意。借用语气、空耳结构、反差或动作机制写成原创表演。沿用已确认的对白和剧情，严肃镜头保留原基调。
6. **组合检查**：在决定组合后调用 `checkCreativeSelection`。返回 `invalid` 时不得用错误 ID；返回 `review` 时先处理时长/题材/画风冲突；`ok` 也不等于镜头质量通过。
7. **提示词编译与审核**：把所选模板各抽出**最少必要的可见事实**，经现有 `cinematicPromptCraft`、`h3-prompt-writing` 和独立提示词审核完成最终生成文本。画布使用已有节点 `nodeTools` 设置提示词、参考与执行；不修改画布 JSON，不暗中直出媒体。

模板取用后，按 [成片审核](video-prompt-review.md) 核对本镜实际的声画、时长和参考。涉及故障或修复时沿用分镜已交代的部件、动作和结果，拍法模板只帮助观众看清这些事实。

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

## H3 同期角色声音提示词模板

- **由 H3 视频生成工作流同时生成声音**，不额外接入独立 TTS 或声音克隆模型。使用已有视频节点，开启 `generateAudio=true`。
- 统一调用 `searchVideoPromptTemplates` 的 `searchCreative(library:"voices")` 检索：音色 `timbre`、情绪 `emotion`、性格 `personality`、语速 `pace`、年龄感 `age`、外国人说中文感 `foreignAccent`、普通话地方口音 `dialect` 和发声方式 `delivery`。优先少量相关模板，避免为一位角色堆叠长串矛盾的形容词。
- `draftVideoPrompt.voiceCast` 按本镜真实说话人填写 `speakerId`、`characterName` 和已确认的声线。按发声方式选择可选的 `sourceId`，画内说话用 `vs01`，仅观众听到的剧情旁白用 `vs02`。音色、情绪和语速按本场另行选择。`S1` 是当前 H3 镜头的说话人编号，跨镜声线沿用角色设定或已确认的对白要求。
- 有对白且启用音轨时按 `speechPolicy` 使用约正常交谈语速 1.3 倍的默认值。特殊角色或场戏可传 `paceId` 或 `speedMultiplier`（二选一）。写清吐字、停顿和重音，实际语速与台词完整性在成片核对。
- “外国人说中文感”和“地方口音普通话”只描述**原中文台词的发音习惯**，不能改写台词、编造发音错别字或冒称精确复现方言。两类口音不能同时应用于一个说话人。方言原文要由剧本提供，不能擅自把普通话改成方言。
- `<Audio N>` 仅引用实际绑定的音频文件；声音模板绝不伪造音频引用。静默镜头不强制速度，未讲话角色保持闭嘴。对 H3 实际发声情况用成片 QC 听验，无法确认则标记未验证。
