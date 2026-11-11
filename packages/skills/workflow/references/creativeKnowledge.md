# 中国网络热梗与抽象搞怪创作知识库

**统一入口：** 主 Agent 和专业子 Agent 使用原有的 `searchVideoPromptTemplates` 分类检索工具，通过 `listCreativeTags` / `searchCreative` 检索最新 2026 网络热梗和原创抽象搞怪拍法。原 `listTags` / `search` 导演模板检索完全保留。两个资料分类是一个工具、两套分类数据，不重复引入第二个 Agent 检索工具。

数据分别维护在 `apps/server/src/agent/creativeKnowledge/memesCN.ts` 和 `absurdPrompts.ts`，按需只返回 1–10 条，不把全部资料灌入系统提示词。
## 何时用

- 用户明确要求**搞笑、抽象、沙雕、整活、玩梗、反差、热梗短剧**；或已经批准的剧情本来带喜剧段落时，才检索。
- 普通都市爽文、严肃科幻、纪录式写实、机械展开等任务，不得自动“加热门梗”改变用户调性或镜头合同。
- 只提“生成图片”“继续做视频”不是使用热梗的授权；仍按原工作流继续，知识库不会改变图片/视频模型或节点配置。
- 真实热梗条目属于**参考素材而非台词强制清单**，按人物性格和叙事可选择不用；重复度过高或存在IP/人设侵权风险时应改写为原创笑点机制。

## 查询方法（只返回 1–10 项）

| 目标 | 工具调用示意 | 使用方式 |
| --- | --- | --- |
| 旧导演模板分类 | `searchVideoPromptTemplates({action: "listTags"})` | 原样保留，查询剧情用途、动作、镜头等 |
| 旧导演模板检索 | `searchVideoPromptTemplates({action: "search", tags: {scene: ["机械变形"]}, limit: 3})` | 原样保留，按 H3 工作流已核实条件筛选 |
| 查看创意分类标签 | `searchVideoPromptTemplates({action: "listCreativeTags"})` | 查看热梗/抽象两组及其标签、数量、日期 |
| 2026 热梗 | `searchVideoPromptTemplates({action: "searchCreative", library: "memes", query: "职场", limit: 4})` | 只取已核实的 2026 词条、观察日期和来源 |
| 抽象图片与视频 | `searchVideoPromptTemplates({action: "searchCreative", library: "absurd", query: "飞行", limit: 3})` | 取原创构图、动作节拍、笑点机制与连续性约束 |
| 交叉检索 | `searchVideoPromptTemplates({action: "searchCreative", library: "all", tags: ["反差"], limit: 5})` | 将两类结果在一个入口按匹配度排序 |


工具 schema 以实际返回为准；上表是使用示意。关键词不足时缩小到单词或改用标签，不因为没匹配就编造热梗。

## 2026 来源与时效

- **范围：只包含 2026 年有公开日期记录的热梗。** 当前快照截至 **2026-11-11**，共 28 条；2025 年年度回顾及仅因 2026 年搜索访问而上榜的明显旧词不再混入“2026最新”分类。
- **2026 年 10—11 月词条**：依据 [是什么意思词典](https://www.ssmys.com/) 的按走红时间标注条目（如 11 月 2 日、10 月 25 日、10 月 14 日等），属于编辑记录，不等于全网真实热度排行。
- **2026 上半年已获媒体报道的热点**：采用 [广告门2026-07-01专题](https://www.adquan.com/article/361636)及 [京东消费观察2026-07-29报道](https://www.p5w.net/roll/finance/202607/t20260729_6489083.htm)，作为年度内较早的参考；优先检索更近的 10—11 月词条。
- 每条保留 `observedAt`、`period`、`sourceUrl`、`sourceLabel`、`evidence`。**2026 有报道不等于该梗诞生于 2026**，更不能宣称当前全网排名；没有足够证据证明首次起源时不得编造。
- **更新机制**：本库是离线随版本发布的日期快照，**不是网络实时爬虫**。下次更新必须验证新词条出处、发布日期、语义和适用场景；旧资料保留真实日期，过时内容不能改时间冒充新梗。


## 抽象提示词如何落到画布

1. 从检索结果**只挑最贴合本场故事的一条喜剧机制**，如“身份反转”“宏大技术撞上生活小事”或“认真对待荒谬设定”。
2. 保留已定稿角色、场景、道具的外形和空间锚点，先定义能看见的笑点触发、动作、反应和镜尾结果。抽象不等于无因果、无物理约束。
3. 图片提示词：将库中 `imagePrompt` 的对象、机位、景别、光影替换为本项目已批准的设定，通过图片生成节点 `node:setPrompt` 录入。
4. 视频提示词：`videoBeat`、`camera`、`continuity` 是拍法灵感，**不是 MiniMax H3 的最终协议提示词**；必须按当前 H3 Skill、镜头合同与审核链生成官方格式，再写入视频节点。每节点一个连续镜头，不能把“→”理解为剪辑切换。
5. 参考图必须通过真实画布端口连接；素材未准备好时先补图，不猜 `<Picture N>` 和 `{{ref N}}`。同一角色/道具的外观应复用已确认参考。
6. 生成要遵守原有算力授权、QC 和版本限制。知识库检索不会触发生成，也不绕过画布。

## 质量审核

- **笑点可拍**：一个镜头里能看到设置、动作及结果，荒谬的点来自反差而非随机堆词。
- **结构稳定**：身体、道具、尺寸、方位和机械连接可追踪，不能突然多手、多腿、道具穿模或瞬移。
- **角色相符**：不能因为热梗而变成与原人物完全不同的语气或世界观。
- **语义合适**：不玩贬低群体、恶意污名或伪健康知识的梗；尊重现实人物和创作者。
- **原创而非照搬**：不复制别人的原视频音轨、整段受版权保护台词、独有角色外形、真人音色。

## 维护入口

- 热梗数据：[memesCN.ts](../../../../apps/server/src/agent/creativeKnowledge/memesCN.ts)
- 原创抽象模板：[absurdPrompts.ts](../../../../apps/server/src/agent/creativeKnowledge/absurdPrompts.ts)
- 分类检索工具：[视频模板分类检索入口](../../../../apps/server/src/agent/videoPrompt/templates/index.ts)；[知识数据与排序](../../../../apps/server/src/agent/creativeKnowledge/index.ts)
- 自动测试：[index.test.ts](../../../../apps/server/src/agent/creativeKnowledge/index.test.ts)

修改数据时确认每条稳定 ID 与来源，不删除仍被生产记录引用的 ID。运行 `bun test src/agent/creativeKnowledge/index.test.ts`（工作目录 `apps/server`）及 GitHub CI 验证。
