---
name: workflow
description: 按小说或用户query制作漫剧。先编剧，再资产规划，再角色、场景、道具原画与对应审核，再视频导演、视频提示词审核与成片审核。出图按系统设置走 Qwen 图像 API 或 ComfyUI 工作流。出视频用 AutoDL 或本机的 ComfyUI。用户要做短剧、漫剧、分镜、资产或镜头时使用。
metadata:
  version: "1.10.0"
  displayName: 漫剧制作
  author: Manga
---

# 漫剧制作

把小说或用户query做成可出图、可出视频的镜头。判断规则用本技能的 references，不要用聊天印象代替。出图以系统提示里的 production.image 为准。出视频的 ComfyUI 按系统设置走 AutoDL 实例，或走本机已经启动的 ComfyUI。

**执行入口约束：** 用户提出“继续”“继续出图”“做角色/场景/道具参考图”“做视频”“连线”“生成分镜”时，以已打开的画布和现有节点为制作主场；主 Agent 必须先读取 [画布落点](references/canvas-use.md) 及 canvas 技能的节点操作说明，再选择真实节点执行，结果与提示词留在画布。生成能力应通过节点 `nodeTools` 使用；只有用户明确要求直接在聊天中生成才允许对话媒体工具。无画布权限就说明阻塞，不默认使用对话 `generateImage` / `generateVideo` 代替。此约束不要求纯文字问答触发画布，也不覆盖算力授权与分阶段确认。

references 里写的 sidecar、POST 和 SQLite 不要调用。合同写进当前画布的文本节点；审核通过后才生成。审核不通过时，只把 findings 退回原来的专职重写，总控不改 prompt、不改槽位。

公共规则读 [common.md](references/common.md)。小说改编定调读 [adaptationStrategy.md](references/adaptationStrategy.md)（原则门，不抄外部死数字）。需要完整场次正文读 [episodeScript.md](references/episodeScript.md)；分场情绪与注意事项读 [directorPlan.md](references/directorPlan.md)。审核分流及原画通用审核顺序见 [prompt-review.md](references/prompt-review.md)。合同怎么落到画布读 [canvas-use.md](references/canvas-use.md)。每阶段写入后须用户明确确认才进入下一阶段，规则见 canvas-use「逐步确认关卡」，节点操作再读 canvas 技能。开始某一阶段前，只读该阶段的参考，不要一次读完。

MangaFlow 的剧本场次、资产复用、阶段确认、角色三视图和画布读写继续使用。一个视频节点只放一个连续摄影镜头。

| 阶段 | 先读 | 完成后 |
| --- | --- | --- |
| 文本改编 | [adaptationStrategy.md](references/adaptationStrategy.md)，题材对得上时再读 [genreCraft.md](references/genreCraft.md) | 剧本画布上的改编原则与取舍 |
| 逐集剧本（可选） | [episodeScript.md](references/episodeScript.md) | 剧本画布上的场次正文；需完整对白时用 |
| 剧本与镜头 | [story-planner.md](references/story-planner.md)，场次与钩子另见 [shortDramaCraft.md](references/shortDramaCraft.md) | 剧本画布上的集与镜头合同 |
| 资产规划 | [asset-planner.md](references/asset-planner.md) | 资产画布上的复用、新建与变体 |
| 角色原画 | [character-art.md](references/character-art.md) 然后 [character-prompt-review.md](references/character-prompt-review.md) | 审核通过的设定图；面部特写加正侧背 |
| 场景原画 | [scene-art.md](references/scene-art.md) 然后 [scene-prompt-review.md](references/scene-prompt-review.md) | 要换机位或反复出现时做四方向拼版；只做氛围或转场时做无人空镜 |
| 道具原画 | [prop-art.md](references/prop-art.md) 然后 [prop-prompt-review.md](references/prop-prompt-review.md) | 审核通过的产品图 |
| 单集导演规划（可选） | [directorPlan.md](references/directorPlan.md) | 分集画布上的分场情绪与注意事项 |
| 成片提示词 | 已有节点先核对实际工作流和模式，新镜用用户指定或 production.video。内置 Agent 用 draftVideoPrompt 读取 [导演 Skill](../cinematicPromptCraft/SKILL.md)、对应的 [H3 规则](../h3-prompt-writing/SKILL.md) 和 [视频审核规则](references/video-prompt-review.md) | 程序预检和独立审核通过后交接英中文稿。出片使用同一已审工作流及参数，并另行确认 |

### 网络热梗与抽象搞怪知识（按需启用，不自动污染剧情）

用户明确要求**抽象、沙雕、整活、热梗、无厘头、搞怪喜剧、反差萌**，或已确认的喜剧场景需要强化笑点时，调用只读的 `searchCreativeKnowledge`（先 `list` 再按 `memes` / `absurd` 查询需要的 1–5 项），并按 [创作知识库说明](references/creativeKnowledge.md) 核对来源、日期、适用场景、原创性和可拍摄动作。该工具返回的是已注明时间的词条样本和原创创意骨架，**不是 2026 年全网实时热榜，也不是直接可提交的 H3 提示词**；严肃剧情不强加热梗，不能用知识库替代阶段合同、主 Agent 审核、画布节点执行或算力授权。特别注意用 `nodeTools` 写入已改写的提示词，生成结果仍必须显示在画布。

### 原画案例参考（不替换生产合同）

角色、场景或道具原画首次设计，或失败重试需要澄清构图、尺度、材质、身份锁时，可以按 asset_type / t2i / edit 从 [imagePromptCases.md](references/imagePromptCases.md) 阅读 1–2 条。其 I01–I04 仅是原创且未生成验证的案例，依当前 [character-art.md](references/character-art.md)、[scene-art.md](references/scene-art.md)、[prop-art.md](references/prop-art.md) 及审核合同重新撰写；不得让案例内容替换已批准的车辆、人物和场景。无需额外调用模型来“润色案例”。

官方风格 skill（已安装，按需选用，不进入默认漫剧成片流水线）：`minimalist-product-ad-generator`、`3d-animation-short-generator`、`papercraft-stop-motion-explainer`、`brand-promo-video-generator`、`music-video-subtitle-generator`、`co-op-game-intro-generator`、`paper-collage-explainer-generator`、`handdrawn-live-video-generator`。仅当用户明确要该风格（产品广告 / 3D 动画短片 / 纸艺定格 / 品牌宣传 / MV 字幕 / 联机开场 / 剪纸拼贴 / 手绘实拍等）时，再用 skillOperator list+read 加载对应风格 skill；不要默认替代上方「成片」路径（h3-prompt-writing + cinematicPromptCraft 导演知识 → video-director → video-prompt-review → Comfy H3 Ref2VA）。

画布出图时先通过图片生成节点的 `node:getConfig` 查询可用模型与当前配置，并由 `node:setConfig` 配置；可用 `listMediaModels` 交叉核实已启用项，但不得因此跳过画布生成节点。先按用户指定、配置的出图后端、是否有底图及参考图数量筛选，再读候选的 `usage`，按草稿速度、细节、底图保留需求选择。设置中的文生图和编辑工作流是对应任务的默认选项。Qwen-Image-2.1 Turbo 适合快速探索，标准版适合细节任务，具体以目录和验收结果为准。编辑用 `<image1>` 指代底图，补充参考图按实际槽位编号。编写、原画审核与生成均使用同一个工作流。出视频只用 ComfyUI 工作流，`providerId` 为 `comfyui`；`production.video.host` 为 `local` 时用本机地址，为 `autodl` 时用 AutoDL 实例。角色设定图 `2048x768`，场景四方向拼版 `1024x1024`，无人空镜 `1344x768`，道具按物体高宽在 `768x1024`、`1024x1024`、`1344x768` 里选。成片 16:9。

生成前把方案里的提示词、参考图和所选工作流给用户看。用户同意后才生成。出视频失败先看当前选中的 ComfyUI 是否连通，不换工作流重试。
