---
name: cinematicPromptCraft
description: 在漫剧或短剧的视频导演阶段，依据剧情意图选择构图、人物表演、动作调度、视觉特效、场景光影、镜头运动和声音方案，形成能在单个连续镜头中执行的视觉设计。用于 video-director 写 H3 视频提示词之前的导演构思；不代替 h3-prompt-writing，也不改剧情、参考槽位、身份锁或审核合同。
metadata:
  version: "1.3.0"
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
- 设计内容只在**导演内部规划**中使用，最终仍由现有 `video-director` 返回原有合同。英文六段格式、Picture/Subject/对白关系词由 `h3-prompt-writing` 与当前 workflow 规则决定。

## 根据镜头目的读取知识（每条镜头按需）

内置 Agent 可调用 searchVideoPromptTemplates 的 listTags 查看标签，再用 search 多选剧情、情绪、表演、动作、特效、摄影、构图、光影、声音和环境。已知时传入时长、参考模式、参考图数量、主体数量和可用锚点。draftVideoPrompt 用同一目录检索，并记录命中的模板。模板里的摄影或动作标签可以表示可选拍法，采纳时核对适用条件，只保留当前镜头确实需要的运动和事件。

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

## 每镜内部导演决策（不要作为新合同字段输出）
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
- 相邻镜头是否因习惯性推镜、同样的表情或“爆炸光芒”而同质化？
- 最终是否只写**本镜可见可听**的事实，并保持 Picture/Subject 和原画锁不变？
