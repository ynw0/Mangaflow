---
name: cinematicPromptCraft
description: 在漫剧或短剧的视频导演阶段，依据剧情意图选择构图、人物表演、动作调度、视觉特效、场景光影、镜头运动和声音方案，形成能在单个连续镜头中执行的视觉设计。用于 video-director 写 H3 视频提示词之前的导演构思；不代替 h3-prompt-writing，也不改剧情、参考槽位、身份锁或审核合同。
metadata:
  version: "1.5.1"
  displayName: 影视导演创作知识库
  author: Manga
---

# 影视导演创作知识库

## 职责与边界
本技能是**创作知识**而不是新的提示词格式、模型接口或新的 Agent。输入来自当前镜头的 story / purpose / must_have / continuity、production_profile、approved_assets、ref_slot_plan、镜头时长和工作流能力。剧情、对白、参考图、服装、道具结构与用户指定视觉风格优先于本库范例；素材不足时按现有 blocked 机制处理。

- 先判定这条镜头**要让观众看见什么变化**，再挑选一种主要视觉表达；不要随机拼贴摄影术语。
- 每个镜头优先确定：叙事焦点、可见主体、起点状态、连续动作、结果状态、机位/运动、光源、声音。主运动原则上只有一种，固定机位也是有效选择。
- 每个动作都应可在给定时长内完成；若同时存在表演、特效与运镜，确定主次和时序，减少互相竞争。
- 把抽象情绪转换为可观察的**动作/眼神/空间/光影变化**；道具、法术和武器补足来源、方向、与周围物体的相互作用。
- 固定外形、场景锚点和人物站位由已批准资产负责，不因为知识库里有类似范例就改动。风格遵循 production_profile；不默认为玄幻、3D 或电影写实。
- 内置 `draftVideoPrompt` 使用 `cinematicPlan` 保存开场、运镜终点、镜尾可见对象和表演节拍，供独立审核与成片验收使用。H3 模型只接收最终 `prompt`，规划不得混进生成正文。英文结构、Picture/Subject/对白关系词由 `h3-prompt-writing` 与当前 workflow 决定。

## 复杂机械镜头容量评估（导演决策）

机翼、车辆、机器人等多部件变形：写正文前按“开场状态 → 外壳开合 → 主机构伸缩/翻折 → 锁定末态”划分有可见结果的状态转换。若约五秒镜头要求同时看清多个相互依赖的机构变化并保留镜尾静止展示，先建议上游拆为相邻的独立摄影镜头。拆镜属于分镜合同修改，不得由导演自行删除 must_have 或更改时长；应依既有 blocked/退回上游流程处理。

- 每个子镜头一个主要机械变化，留出动作读清和末态验收时间。参考资产提供同一车辆可追踪的零件数、连接点与运动来源。

- 官方 Ref2VA 六段式允许用 [keyframe completion] 表达图片作为首帧、尾帧或关键帧锚，也可以直接描述 <Picture N> 对应的目标画面；这是一种语义指导，不等于逐像素锁帧保证。singleImage / refs.slot1 不具备专用 refs.first_frame / refs.last_frame 的输入绑定，禁止承诺与参考图逐像素完全相同；需要真实首尾帧输入时应选择匹配的 h3Frames 工作流。

- 中间态缺失或结构不匹配，先退回资产规划；不要用更长的提示词和精确到毫秒的时间清单代替真实几何条件。

- 评估 A/B 效果时固定参考图、工作流、种子和采样参数，一次只修改一个因素；二采分辨率提高并不保证运动正确。

## 提示词简洁性：最少必要信息

视频正文遵循 **简洁、清晰、可执行**。写镜头所需事实，不追求长篇幅或词数；先定主体/参考绑定与场景锚点，再以一句到数句交代镜头的**起点→动作→结果**，最后补充必要机位和同期声。简单 5 秒镜头可很短，复杂机械运动可适当展开，不能为了凑长度增加动作。

- **只描写与成片验收相关的可见、可听变化。** 参考图和身份段已经锁定的外形，不在每个动作句反复罗列。
- **稳定条件写一次。** 不在每个时间段重复灯光、材质、机位、环境底声、画风或主体位置；声音也不在时间轴和整体声景重复。
- **一镜一个主要事件、一种主运镜。** 保留必要的时间顺序、接触点、零件连接与末态；普通动作不拆成过多分段。
- **避免空词和负担。** 删除“电影级、史诗级、超高清、流畅、真实”等无可验收信息的词串，不补无关粒子、镜头绕圈或复杂表情。
- 官方 H3 字段、参考关系词、对白标记和剧情硬要求仍必须齐全；**结构完整不等于正文冗长**。不要照搬官方多镜范文的推荐篇幅到 MangaFlow 单镜。若删掉某句会导致身份、空间、动作因果、时序或声画关系不明，则保留该句。
- 编辑前做一次删减测试：每句话是否引入**新的、必要、可观察**的信息？没有就删或合并；优先不改已经通过审查的内容。

## 根据镜头目的读取知识（每条镜头按需）

内置 Agent 可调用 searchVideoPromptTemplates 的 listTags 查看标签，再用 search 多选剧情、情绪、表演、动作、特效、摄影、构图、光影、声音和环境。剧情上游如涉及结构设计，可另用同一工具的 `searchCreative` 查询 `narrative`；表情用 `expressions`，画风与滤镜用 `styles`。根据 `checkCreativeSelection` 排除错误组合；多镜 `scope:scene` 只用于分镜规划，不直接粘入一条 H3 生成提示词。已知时传入时长、参考模式、参考图数量、主体数量和可用锚点。draftVideoPrompt 用同一目录检索，并记录命中的模板。模板里的摄影或动作标签可以表示可选拍法，采纳时核对适用条件，只保留当前镜头确实需要的运动和事件。

| 任务特征 | 必读参考 | 按需增读 |
| --- | --- | --- |
| 对话、情绪、反应 | [characterPerformance.md](references/characterPerformance.md) | [compositionAndLens.md](references/compositionAndLens.md)、[soundDesign.md](references/soundDesign.md) |
| 揭示、悬念、静物发现 | [compositionAndLens.md](references/compositionAndLens.md) | [cameraMovement.md](references/cameraMovement.md)、[lightingAndColor.md](references/lightingAndColor.md) |
| 战斗、追逐、碰撞 | [actionChoreography.md](references/actionChoreography.md) | [cameraMovement.md](references/cameraMovement.md)、[visualEffects.md](references/visualEffects.md) |
| 机械变形、装置重组 | [mechanicalTransformation.md](references/mechanicalTransformation.md) | [actionChoreography.md](references/actionChoreography.md) |
| 能量、法术、环境异变 | [visualEffects.md](references/visualEffects.md) | [lightingAndColor.md](references/lightingAndColor.md)、[actionChoreography.md](references/actionChoreography.md) |
| 建立环境、转场场景 | [environmentDesign.md](references/environmentDesign.md) | [compositionAndLens.md](references/compositionAndLens.md)、[lightingAndColor.md](references/lightingAndColor.md) |
| 风格决策、特殊题材 | [visualStyle.md](references/visualStyle.md) | [scenePlaybooks.md](references/scenePlaybooks.md) |
| 同一叙事目标有多种拍法、已有镜头趋同 | [scenePlaybooks.md](references/scenePlaybooks.md) | [examplesAndFailures.md](references/examplesAndFailures.md) |

先读相关的 1–3 份文件，需要时再扩充；禁止每镜默认读取全部 references。复杂镜头可额外读 [cinematography.md](references/cinematography.md) 理清视线轴、景别和视点。

### 优质案例检索（只在能解决本镜具体难题时触发）

当镜头涉及复杂机械形变、人物对白与听者反应、空间揭示、激烈动作、起飞或物理特效，或导演稿反复失败时，先按意图/动作/参考模式从 [publicPromptCaseIndex.md](references/publicPromptCaseIndex.md) 取 0–2 个公开可追溯案例，再按需从 [highQualityPromptCases.md](references/highQualityPromptCases.md) 选取最多 1–3 条原创本地示范。先说清拟借鉴的**动作因果、构图可读性、运镜策略或声画同步**，然后独立重写；不得直接拼接案例进 prompt，不得覆盖已批准角色/道具外形、对白、当前 Picture/Subject 绑定和时长。

本库中的 V01–V09 都属于未经成片验证的示范，源站经验与本地 QC 证据分开记录。已有程序化 searchVideoPromptTemplates 仍是镜头模板检索入口，不需要新增工具或重复跑模型；案例文件只是难题级导演参考，不进入模型的最终 H3 六段式正文。没有匹配案例时不强制使用。


## 每镜导演决策（内置工具保存为 cinematicPlan）
1. **叙事任务**：当前镜头必须交付的唯一主要信息是什么？关联上一镜的状态是什么？
2. **画面焦点**：画面中谁/什么最重要？用构图、视线或变化引导注意，不让所有东西同时成为主角。
3. **起点→动作→结果**：为可见动作、情绪表演、物理反馈安排时序；先明确起点，再说明发生了什么以及末态。
4. **导演选择**：剧情、参考构图或连续性已经确定视点时，直接落实。仍有创作空间且涉及揭示、冲突、觉醒等关键叙事节拍时，参照场景方案，构思两种可执行拍法。让两个方案改变关注对象或信息揭示顺序，比较观众各能看清什么，以及时长、遮挡、身体动作、光声负荷是否允许。选最能交付本镜信息的一个。
5. **光声选择**：选择可在现有场景成立的光源和必要声音；瞬间效果放对应时刻。
6. **执行减法**：删去无叙事必要的第二个运镜、叠加特效、空洞质量词、重复描述；不在 5 秒镜头里硬塞数个高潮。
7. **H3 编译**：把导演决定落实在 `h3-prompt-writing` 的官方结构里；稳定条件只在全局及首段说清，后续时间段重点描写变化及必要的承接。

有当前集已写镜头时，查看同场次相邻镜头与已写的同功能镜头，比较景别、摄影方式、揭示顺序和表演节拍。发现重复先问同构图是否承担连续性、呼应或压迫递增。剧情功能不同且重复削弱区分时，优先改变观众看见的信息或表演重心，其次调整摄影方式。只依据能看到的镜头内容比较。

## 质量自检
- 不看剧情摘要，只看提示词，能否识别主要主体、动作起止与画面结果？
- 角色的眼神、嘴、手、重心是否服务当前行为，是否出现莫名正视镜头？
- 特效是否具备来源、运动、环境反馈和合理消散，而不只是“炫酷发光”？
- 焦段、机位和运动有没有改变叙事焦点，是否与单连续镜头/时长冲突？
- 先确定镜尾画框，再反推运镜路径；人物移动之后，要求同框的物品、头肩、手和表情是否仍能看见？定幅区间开始前，运镜是否已经停止？
- 相邻镜头是否因习惯性推镜、同样的表情或“爆炸光芒”而同质化？
- 最终是否只写**本镜可见可听**的事实，并保持 Picture/Subject 和原画锁不变？
