# 高质量原画提示词案例库（Qwen / ComfyUI）

版本：1.0.0（2026-11-10）。所有案例原创、未实际生成验证，只借鉴公开官方编写原则；使用时严格遵从当前角色/场景/道具提示词合同、正负面节点和已批准的身份结构。

## 参考来源
- Qwen-Image-2.1 官方 T2I Prompt Rewrite：https://github.com/QwenLM/Qwen-Image-2.1/blob/main/prompt_rewrite/prompts/system_prompt_t2i.txt
- Qwen-Image-2.1 官方 Edit Prompt Rewrite：https://github.com/QwenLM/Qwen-Image-2.1/blob/main/prompt_rewrite/prompts/system_prompt_edit.txt
- Runway 官方 Image Prompting Guide：https://help.runwayml.com/hc/en-us/articles/35694045317139-Gen-4-Image-Prompting-Guide
- Runway 官方 Image References Guide：https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References
这些是写法依据，不证明下述本机 ComfyUI 工作流已生成过相同效果。

## 用法
根据 asset_type、当前任务 T2I/edit、已批准主图、应保留/可变更字段读取最多 1–2 条，抽取几何比例/光照/材质/构图的描述方法。案例中的颜色、人物、车辆、机械部件仅为假设设定，不能覆盖真实 canonical_description。先有明确的来源、大小、外形，再谈画面修饰。原画 contract 的 prompt、prompt_zh、negative_constraints、identity_lock 等字段由原角色生成；正面提示词按当前工作流规则，仅写希望可见的状态。

## I01｜角色设定：可追踪身份的中性造型
tags: character; t2i; turn-around; consistency
前提：青年汽车改装师，人物年龄与具体服装仅在未批准阶段作为创意例子。
示范正面画面句（英文）：A full-body character design portrait of a young auto mechanic, standing upright in a neutral three-quarter pose. Short unstyled black hair, a narrow face with subtle under-eye shadows, a washed charcoal work jacket with a small stitched pocket, dark straight trousers and worn work shoes. Both hands and footwear are visible. Soft broad frontal studio lighting reveals natural skin texture and the fabric seams; a simple neutral background and believable human body proportions.
质检：脸与衣装、手数、脚部完整、身高比例可读；若进入正侧背拼版，按对应 workflow 的网格规则生成，不把这条单图文字硬搬成三视图。

## I02｜旧车基准：有真实重量的材质
tags: prop; vehicle; t2i; 3/4-view; physical-scale
示范正面画面句（英文）：A full-size older compact coupe rests on a studio floor, seen from the front and one side. The visible tires meet the floor at their contact patches, with soft shadows beneath them. The dark metallic paint is worn around the wheel arches, and a broad studio light reflects across the hood. The whole car fits in the frame.
质检：同一车身与车轮数量、驾驶室比例、车轮接地、金属而非塑料玩具质感。已批准车图不得换车型/颜色；负面禁忌交给工作流的 negative_constraints。

## I03｜机械机翼母版：静态结构清晰
tags: prop; mechanical; t2i; identity-lock; geometry
示范正面画面句（英文）：Viewed from directly above, the cab is at the top of the frame and the cargo deck extends below it. Two identical folded modules sit to either side of the deck centerline at the same distance behind the cab. Each module rests in its own recessed mount, with the hinge visible where it meets the deck.
质检：确认该视角能看见两套组件的安装点、对称关系和收纳位置。车轮与侧面标识由能看清它们的视角核对。

## I04｜编辑任务：移动底图中已有的部件
tags: prop; edit; preserve-identity

底图已核验为垂直顶视。两块抽拉板水平收在台面下，台面的左右边缘均可辨认。本步只拉出两块板。

示范编辑指令（英文）。Pull the two existing boards straight out from beneath the tabletop, one through each side. Both exposed portions should be the same width, with the boards staying flat. Keep the overhead view, the table position, and the wood grain from the base image.

验收时先确认仍是垂直顶视，再看两块板是否分别从左右伸出、露出宽度是否相同。该角度看不见的桌腿细节由其他视角验收。多张输入时，按实际槽位给各图分配用途。
