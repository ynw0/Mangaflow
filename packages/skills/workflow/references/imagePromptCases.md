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
示范正面画面句（英文）：A single full-size, older compact coupe in a clean three-quarter front studio view, all four wheels attached to the axles and visibly supporting the car. Slightly uneven dark metallic paint with localized wear around the wheel arches, realistic tire sidewalls, transparent windshield with faint interior shapes, flush panel gaps, accurately scaled door handles and rearview mirrors. A ground plane catches soft tire contact shadows, with one broad softbox reflected across the hood. Entire vehicle in frame.
质检：同一车身与车轮数量、驾驶室比例、车轮接地、金属而非塑料玩具质感。已批准车图不得换车型/颜色；负面禁忌交给工作流的 negative_constraints。

## I03｜机械机翼母版：静态结构清晰
tags: prop; mechanical; t2i; identity-lock; geometry
示范正面画面句（英文）：A single full-size road vehicle with two compact hinged wing modules integrated symmetrically along the upper sides of its body. A readable three-quarter front view shows each wing root connected to a recessed mechanical mount, folded wing panels resting within matching body channels, visible seams and fasteners. Metallic industrial surfaces carry consistent fine machining marks. Neutral studio backdrop, soft side lighting, four grounded road wheels, entire vehicle in frame.
质检：左右各一套、翼根来源明确、铰链和收纳位置可追踪；此案例不是用户“银隼01”的已批准外形，不能拿来替换其设定。

## I04｜编辑任务：只改已授权状态
tags: prop; edit; qwen-image; preserve-identity
前提：已经有一张清晰的批准道路模式车辆图，用户/合同只要求展开现有机翼，不改其余外形。若有第二张机翼末态参考图，角色分配必须与工作流 image-reference 规则相符。
示范编辑指令（英文）：Using the supplied road-mode vehicle image as the exact base, unfold the two existing wing modules from their original recessed body mounts into the approved extended position. Keep the same vehicle identity, wheel count and location, body panel shapes, windshield, color, ground plane, camera angle, lighting direction and background. Change only the wing-panel articulation and the exposed wing-root joints; preserve the rest of the image at input fidelity.
质检：仅机翼差异、车身保持、照明一致、结构数量一致。不同输入数量的 image 标签写法以本轮模型官方和 MangaFlow 当前 workflow 为准。
