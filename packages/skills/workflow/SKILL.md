---
name: workflow
description: 按小说制作漫剧。先编剧，再资产规划，再角色、场景、道具原画与对应审核，再视频导演与成片审核。出图直接调用 Qwen 图像 API。出视频用 AutoDL 或本机的 ComfyUI。用户要做短剧、漫剧、分镜、资产或镜头时使用。
metadata:
  version: "1.0.0"
  displayName: 漫剧制作
  author: Manga
---

# 漫剧制作

把小说做成可出图、可出视频的镜头。判断规则用本技能的 references，不要用聊天印象代替。出图直接调用 Qwen 图像 API。出视频的 ComfyUI 按系统设置走 AutoDL 实例，或走本机已经启动的 ComfyUI。

references 里写的 sidecar、POST 和 SQLite 不要调用。合同写进当前画布的文本节点；审核通过后才生成。审核不通过时，只把 findings 退回原来的专职重写，总控不改 prompt、不改槽位。

公共规则读 [common.md](references/common.md)。审核顺序读 [prompt-review.md](references/prompt-review.md)。合同怎么落到画布读 [canvas-use.md](references/canvas-use.md)，节点操作再读 canvas 技能。开始某一阶段前，只读该阶段的参考，不要一次读完。

MangaFlow 的剧本场次、资产复用、阶段确认、角色三视图和画布读写继续使用。一个视频节点只放一个连续摄影镜头。gpt-image 和 Seedance 不用于这条生产线。

| 阶段 | 先读 | 完成后 |
| --- | --- | --- |
| 剧本与分镜 | [story-planner.md](references/story-planner.md) | 剧本画布上的集和镜头 |
| 资产规划 | [asset-planner.md](references/asset-planner.md) | 资产画布上的复用、新建或变体 |
| 角色原画 | [character-art.md](references/character-art.md) 然后 [character-prompt-review.md](references/character-prompt-review.md) | 审核通过后出图。设定图是面部特写加正侧背 |
| 场景原画 | [scene-art.md](references/scene-art.md) 然后 [scene-prompt-review.md](references/scene-prompt-review.md) | 要换机位或反复出现时出四方向拼版；只做氛围或转场时出无人空镜 |
| 道具原画 | [prop-art.md](references/prop-art.md) 然后 [prop-prompt-review.md](references/prop-prompt-review.md) | 审核通过后出图 |
| 成片 | [video-director.md](references/video-director.md) 然后 [video-prompt-review.md](references/video-prompt-review.md) | 审核通过后用 `video/h3_ref2va_1080p`；只有首尾帧修复用 `video/h3_flf_repair` |

出图用系统设置里的 Qwen 图像模型，默认 `qwen-image-3.0-pro`，`providerId` 为 `qwenImage`，直接调模型 API。出视频只用 ComfyUI 工作流，`providerId` 为 `comfyui`；`production.video.host` 为 `local` 时用本机地址，为 `autodl` 时用 AutoDL 实例。角色设定图 `2048x768`，场景四方向拼版 `1024x1024`，无人空镜 `1344x768`，道具按物体高宽在 `768x1024`、`1024x1024`、`1344x768` 里选。成片 16:9。

生成前把方案里的提示词、参考图和所选工作流给用户看。用户同意后才生成。出视频失败先看当前选中的 ComfyUI 是否连通，不换工作流重试。
