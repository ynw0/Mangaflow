# 创作知识库：分类检索与画布使用

主 Agent、编剧/导演及角色、场景等专业子 Agent 继续使用已有 `searchVideoPromptTemplates` 工具，不新增第二套搜索工具，不把全库塞进系统提示词。旧 `listTags/search` 视频导演模板功能不变；新增内容统一通过 `listCreativeTags/searchCreative` 按需检索，每次最多返回 10 条。

## 内容分类

| library | 内容 | 用法 |
| --- | --- | --- |
| `memes` | 2026 年有日期记录的网络用语、AI 二创、魔性空耳及传播语境 | 喜剧/玩梗/抽象创意；输出来源日期和注意事项，不宣称全网实时榜 |
| `absurd` | 20 套原创反差喜剧单镜构思 | 参考设定、笑点机制、镜头节拍和连续性 |
| `expressions` | 38 条人物表情/颜艺，`basic` 常规、`funny` 搞怪、`extreme` 极夸张、`abstract` 抽象 | 角色表情提示词、眉眼嘴动作、肢体、起势/峰值/收束、强度 |
| `styles` | 32 种视觉画风和 16 种滤镜观感 | 制作统一风格、光影、色板、纹理；可以选一个画风搭配一个滤镜 |

当前热梗为 2026-11-11 的离线资料快照，不保证某词在 2026 年首次起源。具体词条必须保留 `observedAt`、`sourceLabel`、`sourceUrl`、`evidence`。DeepSeek 的“蓝色大肥鱼/鲸鱼娘”属于非官方社区二创，不应宣传成产品官方形象；“嘉豪文学”涉及真实同名者被嘲讽，优先借创作机制而非对真人贴标签。旧内容在 2026 年再传播时须明确说明，不冒称新发明。

## 调用示例

```ts
// 原导演模板完全保留
searchVideoPromptTemplates({action: "listTags"})
searchVideoPromptTemplates({action: "search", tags: {scene:["机械变形"]}, limit:3})

// 按需发现分类
searchVideoPromptTemplates({action: "listCreativeTags"})

// 魔性空耳、搞怪剧情
searchVideoPromptTemplates({action: "searchCreative", library:"memes", query:"比比拉布", limit:3})
searchVideoPromptTemplates({action: "searchCreative", library:"absurd", query:"飞行", limit:3})

// 人物颜艺与画风：可分别取 1 条组合，不覆盖角色设定
searchVideoPromptTemplates({action: "searchCreative", library:"expressions", tags:["极夸张表情"], limit:3})
searchVideoPromptTemplates({action: "searchCreative", library:"styles", query:"电影级写实", limit:3})
searchVideoPromptTemplates({action: "searchCreative", library:"styles", tags:["滤镜"], query:"胶片", limit:3})
```

工具 `searchCreative` 可用 `library: "all"` 混合搜索，支持 `query`、`tags`、`limit`；查询不到时不得杜撰模板。对严肃剧情不自动插入热梗；表情和画风可按剧本需要使用，不能破坏主角人设、已采用的参考图与镜头合同。

## 从模板到出图/视频

1. **先明确目标。** 根据用户指定的镜头、角色、情绪与视觉风格选择目标分类；先查标签，后少量精准检索。
2. **分层组合。** 选原有导演模板（镜头结构）+ 至多一个主要表情 + 一个主画风，必要时叠加一个滤镜观感；喜剧桥段按需选择热梗或原创笑点。避免将多个互斥画风、五官状态、滤镜堆成关键词垃圾。
3. **应用到现有资产。** 对表情只改变眼、眉、嘴和肢体反应，保持脸型、发型、服装、年龄、形体；极夸张/抽象表情也必须保证人物一致。画风改变渲染表达，不随意改变机械连接、道具几何及空间。
4. **生成方式。** 用真实画布生成节点填写提示词、配置模型、核对输入/参考并执行；视频每节点仅一个连续摄影镜头，`videoBeat` 是动作草案，需按 H3 Skill 及审核流程整理成最终提示词。
5. **执行边界。** 检索不会调用模型生成，也不会真正施加 LUT/后期滤镜；是否能实现风格取决于当前模型/ComfyUI 工作流。保留用户算力授权和 QC 要求，生成后核对真实输出。

## 源码与维护

- 网络热梗：`apps/server/src/agent/creativeKnowledge/memesCN.ts`
- 搞怪剧情：`apps/server/src/agent/creativeKnowledge/absurdPrompts.ts`
- 表情模板：`apps/server/src/agent/creativeKnowledge/expressionTemplates.ts`
- 画风和滤镜：`apps/server/src/agent/creativeKnowledge/visualStyles.ts`
- 分类索引：`apps/server/src/agent/creativeKnowledge/index.ts`
- 唯一 Agent 工具：`apps/server/src/agent/videoPrompt/templates/index.ts`
- 测试：`apps/server/src/agent/creativeKnowledge/index.test.ts`

新增词条时给出可核实来源与日期，不因维护知识库而新增直接生成工具、侵入原有视频模板库，或重复造搜索模块。
