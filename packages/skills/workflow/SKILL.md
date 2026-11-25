---
name: workflow
description: 根据小说或用户的创作要求制作漫剧。先编剧，再资产规划，再角色、场景、道具原画与对应审核，再视频导演、画布提示词复核与成片验收。出图按系统设置走 Qwen 图像 API 或 ComfyUI 工作流。出视频用 AutoDL 或本机的 ComfyUI。用户要做短剧、漫剧、分镜、资产或镜头时使用。
metadata:
  version: "1.11.2"
  displayName: 漫剧制作
  author: Manga
---

# 漫剧制作

将小说或用户的创作要求改编成可以生成图片和视频的镜头。**剧本、人物和导演表达按故事情境创作，不要照着参考案例逐项套用**；参考里的拍法、台词和情绪反应是可选思路，不是每场必做动作。必须严格保持的仍是用户硬要求、已确认剧情、技术合同、工具调用和阶段授权。判断规则用本技能的 references，不要用聊天印象代替。全流程面向人的自然语言（剧本、对白、分镜、动作描述、审核意见与成片 `promptZh`）遵守系统提示「中文表达质量与语义保真」：简洁不等于压缩造词或临时简称，交付前做语言复核。出图以系统提示里的 production.image 为准。出视频的 ComfyUI 按系统设置走 AutoDL 实例，或走本机已经启动的 ComfyUI。

**执行入口约束：** 用户提出“继续”“继续出图”“做角色/场景/道具参考图”“做视频”“连线”“生成分镜”时，以已打开的画布和现有节点为制作主场；主 Agent 必须先读取 [如何在画布上组织制作成果](references/canvas-use.md) 及 canvas 技能的节点操作说明，再选择真实节点执行，结果与提示词留在画布。生成能力应通过节点 `nodeTools` 使用；只有用户明确要求直接在聊天中生成才允许对话媒体工具。没有画布权限时，说明任务无法继续的具体原因，不默认使用对话 `generateImage` / `generateVideo` 代替。此约束不要求纯文字问答触发画布，也不覆盖算力授权与分阶段确认。

**返修与重做**。以用户指定的当前稿为底稿。改一句对白、一个动作或一处设定，在当前会话读受影响的片段和前后文，原位修改。改人物动机、关键选择或结局，仍在当前会话工作，读完整的相关场戏，并检查直接依赖这次改动的后续情节。用户指定恢复某版时才以该版为来源。

用户明确否定某句对白或某段写法后，保留原句，明确需要修改的位置。复核新稿时对照本轮意见，确认旧句式已经改掉，且原剧情、人物关系和对话的衔接及因果关系仍然成立。定稿更新后，受影响的分镜和锁定对白从同一版本重新取用。

只有用户明确要求排除旧剧情重新创作，或用户纠正后同一项已作废内容又被写回来时，才启用从零起稿的独立编剧会话；新写场戏定稿前按需委派专业对白精修属于局部改稿，不属于重新起稿。交给编剧本轮要求、明确需要保留的事实和选定的原文；只修改局部内容时，还要提供当前稿件中需要修改的片段。从混写剧情和设定的文档中只提取保留项。清理旧成果的范围另行确定。确需确认方向时，询问题材、基调或保留范围，避免把已作废的开场列进选项。

references 里写的 sidecar、POST 和 SQLite 不要调用。合同写进当前画布的文本节点。原画仍按原画审核规则执行。视频提示词由主 Agent 直接写入视频节点，复核现稿后用 `node:setPrompt` 的 `edits` 精确局部修改；不强制独立审核或重写。

公共规则读 [common.md](references/common.md)。小说改编定调读 [adaptationStrategy.md](references/adaptationStrategy.md)（遵循适用的创作原则，不机械套用外部资料中的固定数值）。原创或重写剧情先按 [episodeScript.md](references/episodeScript.md) 写完整场戏、复核剧情，按需精修对白并核对前后差异，再做分镜。分场情绪与注意事项读 [directorPlan.md](references/directorPlan.md)。审核分流及原画通用审核顺序见 [prompt-review.md](references/prompt-review.md)。关于如何在画布上记录制作合同，阅读 [canvas-use.md](references/canvas-use.md)。每阶段按当前运行模式和已有授权推进。普通/半自动确认规则见 canvas-use「逐步确认关卡」。开始某一阶段前，只读该阶段的参考。跨 Skill 用 `skillOperator` 先 `list`，再以目标 `name`、实际 `scope` 和目标 Skill 内的 `path` 调用 `read`。例如读取 H3 全参考格式时，用 `name: "h3-prompt-writing"`、`path: "references/ref-en.txt"`。

MangaFlow 的剧本场次、资产复用、阶段确认、角色三视图和画布读写继续使用。一个 H3 视频节点可以按已确认剧情合同包含一个连续摄影镜头，或多个以 `[Shot N]` 明确切点的内部镜头；反打、蒙太奇、闪回等剪辑手法在用户允许且时长可执行时可以使用。用户明确要求一镜到底时只允许 `[Shot 1]`，不能私自切镜、删减剧情。使用导演工具且确有复杂时间安排时，可在 `cinematicPlan.shots` 记录起止时间、机位与动作，与正文切点一致；直接编写画布正文不需要另外提交规划数据，不另加 `shotMode`。

| 阶段 | 先读 | 完成后 |
| --- | --- | --- |
| 文本改编 | [adaptationStrategy.md](references/adaptationStrategy.md)，题材相符时再阅读 [genreCraft.md](references/genreCraft.md) | 剧本画布上的改编原则与取舍 |
| 场次剧本 | [episodeScript.md](references/episodeScript.md) | 原创或重写时先写完整场次并复核。已有定稿时，重新读取当前版本，核对本轮对白修改意见是否已经落实 |
| 对白精修（新写或大幅重写场戏） | 复用 `subAgent` 的 `role: "story"`，由子 Agent 按需读取 `dialoguePolish/SKILL.md`，主 Agent 不重复载入全文 | 独立提交局部对白建议，主编剧对比原稿、核对剧情与时长后采纳，锁定前完成；无实质问题则保留原稿 |
| 分镜 | [story-planner.md](references/story-planner.md) | 从通过场次复核的正文拆出本次范围的镜头合同 |
| 资产规划 | [asset-planner.md](references/asset-planner.md) | 资产画布上的复用、新建与变体 |
| 角色原画 | [character-art.md](references/character-art.md) 然后 [character-prompt-review.md](references/character-prompt-review.md) | 审核通过的设定图；面部特写及正面、侧面、背面全身图 |
| 场景原画 | [scene-art.md](references/scene-art.md) 然后 [scene-prompt-review.md](references/scene-prompt-review.md) | 要换机位或反复出现时做四方向拼版；只做氛围或转场时做无人空镜 |
| 道具原画 | [prop-art.md](references/prop-art.md) 然后 [prop-prompt-review.md](references/prop-prompt-review.md) | 审核通过的产品图 |
| 单集导演规划（可选） | [directorPlan.md](references/directorPlan.md) | 分集画布上的分场情绪与注意事项 |
| 成片提示词 | 核对视频节点配置及实际参考，读取 [导演规则](references/video-director.md)、适用的 [导演 Skill](../cinematicPromptCraft/SKILL.md) 和 [H3 规则](../h3-prompt-writing/SKILL.md)。复杂镜头可选 `draftVideoPrompt`。 | 先保存到画布，再按 [视频复核标准](references/video-prompt-review.md) 核对当前正文，发现问题原位修改。其他模型按实际格式写作。独立审核按需使用，不是生成条件。 |

### 创作知识库（按阶段取用，严禁堆砌）

按当前创作目标，从 [创作知识库说明](references/creativeKnowledge.md) 精准检索，而不是每镜套用全库。统一入口仍为 `searchVideoPromptTemplates`：原 `listTags/search` 保留导演镜头模板；`listCreativeTags/searchCreative` 支持 `narrative` 剧情节拍、`memes` 热梗、`absurd` 喜剧、`expressions` 颜艺和 `styles` 画风/滤镜。每镜只选择与已批准剧情、人物和参考图相容的少量条目；导演阶段存在更精确的原有拍法模板时优先用它。已选条目可用 `checkCreativeSelection` 检查多镜场次是否在当前时长可执行、是否违背用户的单镜头合同，以及是否在严肃剧情中强行加入热梗、是否让写实角色的表情过度夸张，以及滤镜 ID 是否有误。

分镜规划阶段可用 `scope:scene` 条目构思多镜片段，从现有剧情定下切点和动作。写成片时按确认的分镜选用拍法和表演参考，调用字段见 [提示词工具调用](references/creativeKnowledge.md#与-draftvideoprompt-的直接衔接)。

### 原画案例参考（不替换生产合同）

角色、场景或道具原画首次设计，或失败重试需要澄清构图、尺度、材质、必须保持一致的身份特征时，可以按 asset_type / t2i / edit 从 [imagePromptCases.md](references/imagePromptCases.md) 阅读 1–2 条。其 I01–I04 仅是原创且未生成验证的案例，依当前 [character-art.md](references/character-art.md)、[scene-art.md](references/scene-art.md)、[prop-art.md](references/prop-art.md) 及审核合同重新撰写；不得让案例内容替换已批准的车辆、人物和场景。无需额外调用模型来“润色案例”。

官方风格 skill（已安装，按需选用，不进入默认漫剧成片流水线）：`minimalist-product-ad-generator`、`3d-animation-short-generator`、`papercraft-stop-motion-explainer`、`brand-promo-video-generator`、`music-video-subtitle-generator`、`co-op-game-intro-generator`、`paper-collage-explainer-generator`、`handdrawn-live-video-generator`。仅当用户明确要该风格（产品广告 / 3D 动画短片 / 纸艺定格 / 品牌宣传 / MV 字幕 / 联机开场 / 剪纸拼贴 / 手绘实拍等）时，再用 skillOperator list+read 加载对应风格 skill；不要默认替代上方「成片」路径（h3-prompt-writing + cinematicPromptCraft 导演知识 → video-director → 画布正文复核 → Comfy H3 Ref2VA）。

画布出图时先通过图片生成节点的 `node:getConfig` 查询可用模型与当前配置，并由 `node:setConfig` 配置；可用 `listMediaModels` 交叉核实已启用项，但不得因此跳过画布生成节点。先按用户指定、配置的出图后端、是否有底图及参考图数量筛选，再读候选的 `usage`，按草稿速度、细节、底图保留需求选择。设置中的文生图和编辑工作流是对应任务的默认选项。Qwen-Image-2.1 Turbo 适合快速探索，标准版适合细节任务，具体以目录和验收结果为准。有底图的任务按 [图像编辑与变体](references/common.md#图像编辑与变体) 编写提示词并验收。项目经验只补充本项目的设定与已验证的事实。编写、原画审核与生成均使用同一个工作流。出视频按 `production.video` 和用户确认的节点配置。`comfyui` 走相应的本机或 AutoDL 工作流，`videoModel` 使用设置中已选的云端模型。提示词结构与实际模型匹配。角色设定图 `2048x768`，场景四方向拼版 `1024x1024`，无人空镜 `1344x768`，道具按物体高宽在 `768x1024`、`1024x1024`、`1344x768` 里选。成片画幅遵从用户确认的镜头合同、项目生产配置与实际视频节点的比例设置；统一 H3 Ref2VA 工作流支持按能力选择 16:9、9:16 等比例，16:9 只是未指定时的默认值，不是强制规格。模型/工作流不支持所选比例或节点设置冲突时须先校验并处理，不能仅通过修改提示词，在没有说明的情况下覆盖实际配置。

统一 H3 双采的主模型由本次实际使用的 ComfyUI 实例和用户确认的选择决定。节点缺 checkpointName 时，在写成片提示词前通过 node:getConfig({refreshComfyChoices:true}) 读取 checkpointChoices，再用 node:setConfig 写回已确认的文件名。

生成前展示本次提示词、参考、工作流、对象与数量，以及费用或算力预算。普通/半自动按关卡确认。自动出图可连续执行已授权范围内的生成、检查和返工。目标模式可继续已授权的目标。超出生成范围或预算时再确认。出视频失败先检查 ComfyUI 连通性。

视频选片与交付时，按[成片归档与废片清理](../canvas/references/videoProduction.md#成片归档与废片清理)保存采用版本并清理本轮废片副本。
