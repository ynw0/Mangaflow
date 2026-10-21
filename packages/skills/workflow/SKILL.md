---
name: workflow
description: 按小说制作漫剧。先编剧，再资产规划，再角色、场景、道具原画与对应审核，再视频导演与成片审核。出图直接调用 Qwen 图像 API。出视频用 AutoDL 或本机的 ComfyUI。用户要做短剧、漫剧、分镜、资产或镜头时使用。
metadata:
  version: "1.2.0"
  displayName: 漫剧制作
  author: Manga
---

# 漫剧制作

把小说做成可出图、可出视频的镜头。判断规则用本技能的 references，不要用聊天印象代替。出图直接调用 Qwen 图像 API。出视频的 ComfyUI 按系统设置走 AutoDL 实例，或走本机已经启动的 ComfyUI。

references 里写的 sidecar、POST 和 SQLite 不要调用。合同写进当前画布的文本节点；审核通过后才生成。审核不通过时，只把 findings 退回原来的专职重写，总控不改 prompt、不改槽位。

公共规则读 [common.md](references/common.md)。小说改编定调读 [adaptationStrategy.md](references/adaptationStrategy.md)（原则门，不抄外部死数字）。需要完整场次正文读 [episodeScript.md](references/episodeScript.md)；分场情绪与注意事项读 [directorPlan.md](references/directorPlan.md)。审核顺序读 [prompt-review.md](references/prompt-review.md)。合同怎么落到画布读 [canvas-use.md](references/canvas-use.md)。每阶段写入后须用户明确确认才进入下一阶段，规则见 canvas-use「逐步确认关卡」，节点操作再读 canvas 技能。开始某一阶段前，只读该阶段的参考，不要一次读完。

MangaFlow 的剧本场次、资产复用、阶段确认、角色三视图和画布读写继续使用。一个视频节点只放一个连续摄影镜头。gpt-image 和 Seedance 不用于这条生产线。

| 阶段 | 先读 | 完成后 |
| --- | --- | --- |
| 文本改编 | [adaptationStrategy.md](references/adaptationStrategy.md) | 剧本画布上的改编原则与取舍 |
| 逐集剧本（可选） | [episodeScript.md](references/episodeScript.md) | 剧本画布上的场次正文；需完整对白时用 |
| 剧本与镜头 | [story-planner.md](references/story-planner.md) | 剧本画布上的集与镜头合同 |
| 资产规划 | [asset-planner.md](references/asset-planner.md) | 资产画布上的复用、新建与变体 |
| 角色原画 | [character-art.md](references/character-art.md) 然后 [character-prompt-review.md](references/character-prompt-review.md) | 审核通过的设定图；面部特写加正侧背 |
| 场景原画 | [scene-art.md](references/scene-art.md) 然后 [scene-prompt-review.md](references/scene-prompt-review.md) | 要换机位或反复出现时做四方向拼版；只做氛围或转场时做无人空镜 |
| 道具原画 | [prop-art.md](references/prop-art.md) 然后 [prop-prompt-review.md](references/prop-prompt-review.md) | 审核通过的产品图 |
| 单集导演规划（可选） | [directorPlan.md](references/directorPlan.md) | 分集画布上的分场情绪与注意事项 |
| 成片 | 先读 bundled [h3-prompt-writing](../h3-prompt-writing/SKILL.md)：Ref2VA 先读 `references/ref-en.txt`，首尾帧再读 `references/base-en.txt`；再读 [video-director.md](references/video-director.md)，然后 [video-prompt-review.md](references/video-prompt-review.md) | 审核通过后用 `video/h3_ref2va_1080p`；只有首尾帧修复用 `video/h3_flf_repair` |

官方风格 skill（已安装，按需选用，不进入默认漫剧成片流水线）：`minimalist-product-ad-generator`、`3d-animation-short-generator`、`papercraft-stop-motion-explainer`、`brand-promo-video-generator`、`music-video-subtitle-generator`、`co-op-game-intro-generator`、`paper-collage-explainer-generator`、`handdrawn-live-video-generator`。仅当用户明确要该风格（产品广告 / 3D 动画短片 / 纸艺定格 / 品牌宣传 / MV 字幕 / 联机开场 / 剪纸拼贴 / 手绘实拍等）时，再用 skillOperator list+read 加载对应风格 skill；不要默认替代上方「成片」路径（h3-prompt-writing → video-director → video-prompt-review → Comfy H3 Ref2VA）。

出图用系统设置里的 Qwen 图像模型，默认 `qwen-image-3.0-pro`，`providerId` 为 `qwenImage`，直接调模型 API。出视频只用 ComfyUI 工作流，`providerId` 为 `comfyui`；`production.video.host` 为 `local` 时用本机地址，为 `autodl` 时用 AutoDL 实例。角色设定图 `2048x768`，场景四方向拼版 `1024x1024`，无人空镜 `1344x768`，道具按物体高宽在 `768x1024`、`1024x1024`、`1344x768` 里选。成片 16:9。

生成前把方案里的提示词、参考图和所选工作流给用户看。用户同意后才生成。出视频失败先看当前选中的 ComfyUI 是否连通，不换工作流重试。
