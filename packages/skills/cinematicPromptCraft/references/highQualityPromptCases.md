# 高质量视频提示词案例库（影视导演参考）

版本：1.0.0（2026-11-10）。供 video-director / cinematicPromptCraft 按需查阅，不是替代 H3 官方格式的系统指令，不是“验证成功的真实生成结果”。

## 来源及证据等级
- A｜MiniMax 官方： https://github.com/MiniMax-AI/MiniMax-H3 （H3 Prompt Writing Skill 和 ref-en/base-en），用来确认结构与参考标签，而不是抄袭官方画面表达。
- A｜Runway 官方 Gen-4 Prompting Guide：https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide —— 图生视频重点描写运动、简洁增量迭代、优质首图。
- A｜Google DeepMind Veo 官方 Prompt Guide：https://deepmind.google/models/veo/prompt-guide/ —— 主体、构图、动作、镜头、灯光和声音具体描述。
- B｜fal H3 教程：https://fal.ai/learn/tools/minimax-h3-explained —— 赋予每种参考独立任务、分段描述运动与声轨；其案例面向对应 API，参数不能直接套到本机 ComfyUI。
- B｜H3 社区公开案例索引：https://github.com/akirakai/awesome-minimax-h3-prompts —— 仅用于发现参考，不能假定社区案例已独立复现。
- 下文 V01–V09 全部是为 MangaFlow **原创、待生成验证的示范**，并非上述网站的原提示词或已获 QC 通过的真实样片；所有动作、场景需替换为当前批准资产与剧情。

## 外部公开优质案例
需要对照真实已发布提示词和输出示例时，先读 [publicPromptCaseIndex.md](publicPromptCaseIndex.md)；其中有 Runway、Veo 和 H3 供应商公开演示的原始链接、可借鉴技法与模型适配限制。这些公开案例没有经过本机同工作流复验。

## 检索与用法
1. 按当镜 intent、scene/action/performance/camera、时长、ref mode、可见锚点定位，优先匹配“难题类型”，再匹配视觉风格。
2. 一次最多阅读 1–3 条。每条只参考动作之间的因果关系、画面构图、运镜方法以及声音与画面的对应关系，不照搬人物、道具外形、对白和参考素材的绑定关系，也不得直接复制「示范导演核心」的原句。
3. 若案例与镜头合同、已批准素材、模型输入模式或时长冲突，直接放弃案例，不能反向改合同。
4. 以下案例用于参考拍法。Ref2VA 按 h3-prompt-writing 写六段正文，单镜或多镜以实际分镜合同为准。同一镜头内的行动节拍写在时间轴内，批准的切镜用 `[Shot N]` 单独标记。审稿对照实际提示词与合同。
5. 复用后保存 source_case_id、使用位置、变更点；成片 QC 后才能记 success 或 failure。默认 evaluation=pending，严禁把“精心设计”写成“已验证”。

## V01｜欠债压迫：两人对峙与道具交接
tags: intent=dialogue; scene=谈判/质问; emotion=压迫; camera=固定机位; duration=5-7s; references=角色+场景+欠条。
前提：同框看清两人、账本与催款单据的交接，单镜完成。
只参考动作之间的因果关系：固定双人中景中，可以看清纸张从一方推到另一方的位置。接收者先看向对方，再低头看纸张。下一镜能够延续纸张在本镜结束时的位置。不要照搬案例中的具体站位和时间安排。
易错：单据瞬移、眼神正视摄影机、推近后看不见接触点。

## V02｜主角无声反应：界面突现
tags: intent=reveal; scene=觉醒/反应; emotion=惊疑; camera=固定机位; duration=5s; references=主角+手机/界面+场景。
前提：批准界面发光，角色无对白。
只参考动作之间的因果关系：先有界面变亮，再有人物对屏幕的可见反应（停手、视线落到屏上等按本场表演）；镜头结束时，仍能辨认屏幕和人物。勿套用固定「光打脸部某处 + 手指悬停」公式。
易错：未批准 UI、文字乱码、角色朝镜头喊。

## V03｜旧车首次展示：车身材质与反光清晰可见
tags: intent=reveal; scene=登场/场景建立; emotion=哀伤/希望; camera=缓慢拉开; duration=5s; references=旧车+车间。
前提：展示批准旧车的磨损与可靠感，不做变形。
只参考动作之间的因果关系：通过一次幅度较小的运镜，让观众看见车头和车辆与地面的接触情况。工作灯在真实起伏的车身钣金上形成不均匀的高光，划痕和氧化痕迹清楚可见，镜头结束时车身轮廓完整。不要堆砌没有具体含义的画质形容词。
易错：修成崭新超跑、车标漂移、绕车一整圈超时。

## V04｜机翼展开：可追踪机构
tags: intent=mechanical; scene=机械变形; action=旋转/伸缩/锁定; camera=固定机位; duration=5-7s; references=道路模式+中间态+展开态。
前提：铰链、翼片归属与两侧数量在批准图中可对应。
只参考动作之间的因果关系：在同一画面中看清部件从哪里开始开合、如何运动，以及最终锁定的位置。车轮和驾驶室保持原有外形，声音与实际接触动作同步。拥挤时拆相邻镜头。勿写毫秒级施工清单或固定末尾静帧秒数套路。
易错：无来源多出翼片、左右互换、镜尾仍在动。

## V05｜道路行驶：速度的物理证据
tags: intent=action; scene=追逐; action=行驶/转向; camera=侧向跟拍; duration=5s; references=车辆+道路。
前提：只拍疾驶，不变形。
只参考动作之间的因果关系：摄影机以与车辆相同的速度跟拍，背景中的参照物向后移动，轮胎始终与地面接触，悬架随路面起伏作出相应变化。
易错：轮停、背景死、车身漂浮。

## V06｜第一次离地：有重量的飞行
tags: intent=action; scene=装置启动/揭示; action=离地; camera=低机位; duration=5s; references=机翼展开车+空旷道路。
前提：上镜机翼已展开；本镜只负责离地。
只参考动作之间的因果关系：先表现车辆受力及姿态的变化，再借助参照物让观众看清车轮与地面的距离逐渐拉大。镜头结束时，机械机构仍保持已批准的连接关系。不要为了增加篇幅而堆砌不必要的航空术语。
易错：瞬移上天、脚下无参照、道路/飞行形态混用。

## V07｜对白+反应：说话人与听话者分离
tags: intent=dialogue; performance=对话口型/沉默反应。
前提：对白由合同提供；S1/S2 与 Subject 不互相代替。
只参考动作之间的因果关系：说明谁在说话、在对谁说话，为完整说出原话留足时间。听者可以继续手头的工作；如果某句台词使其改变动作，反应就从那句台词接起。语速按本镜 `voiceCast`（默认约 1.3 倍交谈速，以用户与合同为准）。
易错：编号混用、两人同动嘴、台词挤在最后一秒。

## V08｜特效有传播路径：设备能量启动
tags: intent=effects; scene=装置启动; effect=电弧/脉冲; camera=固定机位; duration=5s; references=装置+工作台。
前提：已有发光点与供能通路。
只参考动作之间的因果关系：先出现引发特效的事件，再沿已有路径传播，引起局部变化，最后逐渐消退。背景噪声不应为了制造虚假的高潮而突然变大。不要让来源不明的光效铺满画面。
易错：特效无源头、未触碰就通电。

## V09｜FL2VA 首尾帧之间的物理动作
tags: intent=mechanical; scene=机械变形; action=折叠/锁定; camera=固定机位; duration=5s; references=严格首帧+严格末帧。
前提：真实 FL2VA 首尾帧输入，不能用普通 Ref2VA 冒充。
只参考动作之间的因果关系：部件沿已有铰链或导轨，从首帧的结构状态运动到末帧的结构状态。车身仍是同一主体，机位保持连续，镜头结束时符合末帧构图。不要机械套用固定的静止画面时长。
易错：重画车身替代折叠、首末构图不一致却强行插值。

## 案例反馈登记格式
case_id / shot_id / input_mode / input_refs / workflow_name / duration / changed_prompt_span / QC_observations / failure_class / rework / recheck_result / source_link_or_local_video / evaluation。
failure_class 只从 identity_drift、geometry_error、motion_error、camera_error、lip_sync、audio_error、timing_error、asset_issue 中选择有证据的项。尚未生成 = pending；未完成复验 = unverified；模型质检有真实日志且符合全部镜头硬要求才记 passed。禁止将示范案例本身写成已验证结果。
