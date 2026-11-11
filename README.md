# MangaFlow

**基于 [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) 的 AI 漫剧与短剧制作工作台。** 将剧本、角色、场景、道具、参考素材、视频生成及质检整合到可操作的无限画布，主 Agent 和专业子 Agent 协同推进制作。

[Windows 版下载](https://github.com/ynw0/Mangaflow/releases/latest) · [源码仓库](https://github.com/ynw0/Mangaflow) · [问题反馈](https://github.com/ynw0/Mangaflow/issues) · [上游 Toonflow](https://github.com/HBAI-Ltd/Toonflow-app)

> **发布范围**：本仓库的 GitHub Release 以 Windows x64 **`.exe` 安装包**为主。页面中的版本、工作流和可用模型以实际安装环境、已启用插件及 ComfyUI 模型为准。软件不包含需要另外下载的 AI 模型权重。

## 主要能力

| 模块 | 作用 |
| --- | --- |
| 画布优先的 Agent 制作 | 新建或复用文本、图片生成、图片素材、视频生成等节点，设置提示词/模型，连接真实参考素材，执行节点并在画布查看结果 |
| 漫剧生产 Skill | 小说/创意 → 剧本与镜头 → 资产规划 → 角色/场景/道具原画 → 提示词审核 → 视频 → QC；局部请求只推进相关阶段 |
| 图片生成与复用 | 通过所配置的图片生成工作流出图；保存提示词、参数及图像节点输出。已采用素材可固定为图片节点供后续镜头连接 |
| 视频生成 | 通过配置的 ComfyUI 工作流生成连续镜头，支持实际工作流允许的参考、时长、二采、LoRA 与超分参数 |
| 视频提示词制作 | H3 Ref2VA 等工作流的镜头提示词生成、审核、版本核对、参考顺序与中文对照 |
| 中国网络热梗知识库 | 按来源日期与场景检索中国网络热梗；区分 2026 年 11 月站点关注快照与 2025 年度回顾，不冒充全网实时榜 |
| 抽象搞怪创作库 | 20 套原创荒诞喜剧图像/单镜头视频构思，附笑点机制、机位、动作和连续性检查 |
| 质检与整改 | 视频 QC 输出问题/证据，主 Agent 据此制定覆盖问题编号的整改计划；计划本身不等于自动重生成 |
| 可配置的多模型 Agent | 主 Agent 与角色、场景、道具等专业子 Agent 可分别指定对话模型、思考等级；模型支持的思考档位可在设置中主动探测 |
| 运行中引导 | 当前任务执行时可补充文字要求，加入同一 Agent 会话；不因为普通补充消息就取消已提交的生成任务 |
| MCP 和插件 | 使用当前应用连接的 MangaFlow MCP 与内置节点/工具系统，不直接编辑画布 JSON 来冒充执行 |

## 核心设计：默认在画布上制作

MangaFlow 的生产指令应当落实到**可编辑、可继续使用的画布节点**，而不只是聊天里的一张图片或一段完成说明。

```text
用户：“继续做角色参考图”
          │
          ▼
查询当前画布、已有节点与素材
          │
          ▼
复用图片生成节点，或新增所需节点
          │
          ▼
写入提示词 → 检查模型/尺寸 → 连接已就绪参考
          │
          ▼
展示方案并核对已有的算力授权
          │
          ▼
调用图片节点的生成函数
          │
          ▼
回读节点输出 → 在画布查看图片 → 后续镜头复用
```

- **默认画布路径**：出图、出视频、继续制作、补原画和镜头推进时，主 Agent 使用画布工具和对应节点的函数执行。提示词、配置、连线、实际输出留在画布。
- **明确聊天直出**：只有用户清楚说出“直接在对话中生成图片/视频”等要求，才为这轮主 Agent 开放聊天媒体生成工具。
- **不隐式降级**：画布未打开、连接失效或节点工具不可用时说明阻塞，不暗中改为聊天媒体生成，也不直接篡改画布 JSON。
- **安全与延续**：已采用素材优先复用；新增模型或重试不得未经授权消耗算力；执行中的工具和视频任务不因普通中途引导而被重复提交。

画布工具由 `packages/tools/canvas/` 提供，具体节点功能由 `getNodeTools` 动态查询。图片/视频节点已经负责自己的提示词、输入引用、模型与执行状态，主 Agent **复用这些模块而不是重复实现生成服务**。制作约束见 [workflow Skill](packages/skills/workflow/SKILL.md)、[画布生产指南](packages/skills/workflow/references/canvas-use.md) 与 [canvas Skill](packages/skills/canvas/SKILL.md)。

### 节点落点

| 内容 | 放在画布的哪里 |
| --- | --- |
| 剧本、角色设定、镜头合同 | 文本节点 |
| 待生成的角色/场景/道具图 | 图片生成节点（提示词、生成设置及输出） |
| 已确认并固定的参考图片 | 图片素材节点，通过实际图片端口连接 |
| 单个连续镜头 | 视频生成节点（参考输入、英/中文提示词、真实工作流配置与输出） |
| QC 问题与整改 | 与对应视频产物关联的 QC 记录及整改计划 |

> 每个视频生成节点只负责一个连续摄影镜头。不得为了生成方便把多个镜头硬切塞进一个节点；没有就绪参考素材时不虚构连线。

## 创作知识库：中国网络热梗与抽象搞怪

两套资料由主 Agent、角色/场景/道具等子 Agent 通过只读工具 **`searchCreativeKnowledge`** 按需检索；不把整个热梗库塞进系统提示词，避免消耗上下文及在严肃剧情中强行加梗。

- **中国热梗库（24 条）**：提供词语/句式、观察日期、来源、含义、适用笑点与不适合的用法。2026 年条目来自截至 2026-11-10 的[梗百科站内访问样本](https://www.geng8.com/rank/month/2026-11/)；2025 年年度语汇参考公开年度名单，**均不是实时全网热度排行**。
- **原创抽象搞怪提示词库（20 条）**：赛博生活、职场荒诞、动物拟人、机械反差、奇幻撞科技等；每条有 `imagePrompt`、`videoBeat`、`camera`、`continuity`、`jokeMechanism`，可改写成当前角色/场景的创作方案。
- **触发条件**：只有用户要求热梗、沙雕、抽象、搞笑、反差，或已经确定的喜剧情节需要笑点时使用；严肃故事不默认植入。
- **执行边界**：知识库只是创意检索，不提交图片或视频任务；经过角色设定、镜头合同和必要审核后，仍在画布节点中填提示词、连线和生成。H3 视频提示词必须重新适配其专用格式与连续镜头规范。
- **版本与更新**：初始快照日期 **2026-11-11**，目前是离线内置库，**不会自动联网爬取或每天自动更新**。补充热梗必须保留来源及观察时间，不能把旧词直接标记为最新。

示例：

```text
“给飞行汽车加一点反差萌，但不要改变机械结构。”
→ searchCreativeKnowledge：检索“飞行”“机械”“反差”
→ 取 1 条喜剧机制，融入本次已批准的角色与场景
→ 画布图片/视频生成节点设置经审核的提示词
→ 检查真实参考与连接，获得算力许可后生成
```

维护：[热梗数据](apps/server/src/agent/creativeKnowledge/memesCN.ts) · [搞怪提示词](apps/server/src/agent/creativeKnowledge/absurdPrompts.ts) · [检索接口](apps/server/src/agent/creativeKnowledge/index.ts) · [创作知识库使用规范](packages/skills/workflow/references/creativeKnowledge.md)。

## 安装与使用

1. 从 [Releases](https://github.com/ynw0/Mangaflow/releases/latest) 下载当前发布的 `mangaflow-<版本>-Setup.exe`，在 Windows 安装。
2. 启动 MangaFlow，打开或新建工作区，再打开目标画布。
3. 在设置中配置**文本模型**及用于图片/视频的模型或 ComfyUI 工作流；确认模型权重与所需自定义节点已在对应 ComfyUI 实例中安装。
4. 在画布对应的 Agent 中描述本次任务。例如“先做主角和车辆参考图，放到资产画布上”，Agent 会按当前授权与阶段确认推进。
5. 在画布检查生成结果、节点输入、已采用素材与 QC。继续制作应复用既有节点和已批准的资产。

**模型思考等级探测**：设置 → 文本模型 → 编辑供应商 → 展开目标模型 → 思考等级 → 探测支持的思考等级；确认结果后保存修改。探测需要当前供应商接口可用，返回的支持档位以实际服务为准。

**运行中发消息**：在同一对话追加文字引导不会自动中止当前任务；引导在工具完成后的安全轮次生效，不能追溯修改已经开始的 ComfyUI 推理。停止按钮仍用于主动取消。

## 本地 ComfyUI 与生产注意事项

- 图片使用项目配置的文生图/图片编辑工作流；具体可选项以设置及节点 `getConfig` 查询结果为准。
- 视频使用当前配置的 ComfyUI 工作流，例如 MiniMax H3 Ref2VA 主生产与 FLF 修复流程；工作流名称、模型文件和 LoRA 必须与本机实际安装相符。
- 二采、超分、LoRA、输出一采视频等属于具体工作流及视频节点参数，只有实际支持时才能启用。
- 不把“开始生成”“文件保存”“模型 QC 通过”“人工采用”混为一谈。失败后先检查原任务/节点状态，避免重复生成。
- ComfyUI 与模型服务由用户自行部署/配置；本仓库不会把模型权重或 API 凭据打进安装包。

## 代码结构

```text
apps/
  desktop/              Windows 桌面客户端及打包
  web/                  画布与 Agent 对话界面
  server/
    src/agent/           主 Agent、子 Agent、生产工具与画布桥接
    src/agent/creativeKnowledge/ 热梗与抽象搞怪知识库及只读检索
    src/utils/production/ 视频 QC、生成记录与结果
packages/
  nodes/                图片、视频、文本等画布节点
  tools/canvas/         画布查询、创建、连线与节点工具调用
  tools/mediaGeneration/聊天直接媒体生成（需明确选择直出）
  skills/canvas/        画布操作手册
  skills/workflow/      漫剧生产流程与参考规范
workflows/              项目内 ComfyUI 工作流及绑定配置
.github/workflows/      自动检查与 Windows EXE 构建
```

## 开发与验证

项目是 Bun 工作区仓库；请按仓库的锁定依赖和各工作区脚本进行构建。

```bash
git clone https://github.com/ynw0/Mangaflow.git
cd Mangaflow
bun install --frozen-lockfile

# 本地开发（Web + Server）
bun run dev

# Server / Web / 节点的类型检查及回归测试由 CI 执行
bun run typecheck

# Windows 客户端打包使用 GitHub Actions 的 Windows Release 工作流
```

关键回归测试：[画布优先媒体路由](apps/server/src/agent/runtime/canvasMediaRouting.test.ts) 验证普通制作、继续制作、聊天明确直出、拒绝误判、子 Agent 权限及画布缺失等情况。 [创作知识库回归测试](apps/server/src/agent/creativeKnowledge/index.test.ts) 验证来源、日期、检索范围及模板连续性。发布前应核对 [GitHub Actions](https://github.com/ynw0/Mangaflow/actions) 的检查结果；类型与单元测试通过不等于已在本机 ComfyUI 完成端到端生成测试。

## 版本及与上游的关系

MangaFlow 在 [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) 的开源架构上进行定制，保留并扩展其无限画布、节点工具和 Agent 创作方式。本仓库独立开发与发布的内容不代表上游官方配置或服务承诺。

感谢 Toonflow 项目及所有开源依赖作者。遵守本仓库 [MIT License](LICENSE) 和相关第三方许可；保留上游版权声明。
