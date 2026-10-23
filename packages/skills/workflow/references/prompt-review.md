# 提示词审核（文生图 / 文生视频）

专职只审核已写成的合同，不改写 prompt、不改 lock、不改 Picture 槽位、不生成、不宣布批准。文生图工与文生视频工禁止混审。

## 文生图（character / scene / prop-prompt-review）

### 文生图输入（缺一则 blocked）
- `GET /projects/{project}/story?chapter=` 返回的本章原文（不要一次拉全书）
- 当前 `production_profile`
- 资产规划项：canonical_description、required_state、allowed_variant_changes、evidence
- `GET /projects/{project}/assets` 中该资产登记与 sidecar `still_formats`
- 原画专职刚输出的完整 canonical_art 合同
- `_common.txt` 与对应原画 AGENTS.md（character-art / scene-art / prop-art）

### 文生图审核顺序
1. 对照原文：身份、外形、空间、结构、数量、位置关系是否与小说已写明的事实一致；有无跑题或把别的实体写进本张。
2. 对照规划：required_state 必须能在画面里成立；allowed_variant_changes 不得画进 canonical；不得把未确认属性写成已锁定事实。
3. 对照制作规则：画幅与类型匹配；正面 `prompt` 正文应为英文（以拉丁词为主）；若正文以汉字为主，判不合格并要求改写成英文。须另有非空 `prompt_zh` 简体中文对照（给人审阅，不进模型）。页脚 `Visual Style:` / `Still:` 由 sidecar 追加，不要求出现在专职 prompt 里；正面 prompt 无否定写法；禁忌只在 negative_constraints 且写成不想要的画面事实；锁写进 prompt 正文；review_checklist 5–8 条且都是本张能看见的正向事实；类比尺寸写法、空词堆砌按 `_common.txt` 判不合格。另检：施工清单式堆砌或空词「有体积光/有纵深感」；否定/排除词入正面；多格是否逐格正向（禁「其余格不要」）；全图 negative 是否误伤只在某一格需要的元素（见 `common.md`「写法克制」「原画正负面与多格」）。
3b. 场景合同须有可核对的命名锚点（非纯氛围形容词）；道具合同须有可核对的尺度表述（手持/桌面/家具或等价）。空景无人、白底无手已有规则仍检。
4. 尚待设计的普通细节允许原画提出方案，不因此退回。原文已确认的事实被改写、编造或删掉则退回。

### 文生图输出与交接
只返回 `art_prompt_review`。合格：status=ok，findings 必须 []。不合格：status=rejected，findings 含整改意见。缺原文或关键设定：公共 blocked。总控把 rejected 退回对应原画专职；status=ok 后将 art 与 review 一起 POST `/assets/prompt`。提示词工不提交 sidecar。

## 文生视频（video-prompt-review）

### 文生视频输入（缺一则 blocked）
- `GET /projects/{project}/story?chapter=` 返回的本章原文
- `POST /shots/prepare` 完整结果：剧情、用途、时长、硬要求、相邻镜头、continuity、已批准资产、ref_slot_plan、工作流时长能力、production_profile
- video-director 刚输出的完整合同
- `_common.txt` 与 `prompts/video-director/AGENTS.md`

### 文生视频审核顺序
1. 对照原文与镜头 story：动作、因果、对白文本、人物持物与入出镜是否一致；有无跑题或另写一场戏。动作被改成产品说明，判不合格。资产外形对照该槽 `approved_image_prompt`，由你判断棚拍和画幅不算成片外形。沿用与批准原画冲突的旧外形，判不合格。原文里的旧外形没有逐字出现，不作为退回理由。
2. 对照准备结果：duration_seconds 必须等于给定时长。prompt 是六段纯文本，顺序为 subject_definitions、summary、retention_analysis、detailed_description、overall_soundscape、non_diegetic_music。summary 以 [reference generation] 开头。detailed_description 先写风格，再写 [Shot 1]，之后用 [Shot N] At MM:SS.mmm。分镜编号连续，时间点递增，最后一段起点小于成片时长，中间无缺口。ref_bindings 与 ref_slot_plan 各项和顺序完全一致；Picture 引用只使用现有槽位。动作句用 `<Picture N>` 加登记名指代本镜槽位，N 与槽位一致。角色、道具和场景的定义都用 `<Subject N>`，编号等于槽位号。整段原画贴进动作句，判不合格。must_have 里的剧情事实要进入 prompt，不要求把旧外形逐字粘贴。开口必须写成 `<Subject N> (S1)` 加 `<d>[Chinese] 剧情原文</d>`，完整台词只出现在 `<d>` 里。每个 `<Picture N>` 行必须有且只有一个关系词：fully_preserved、partially_preserved、attribute_transfer、weak_reference，并与该参考图在本镜里的实际用法一致。同一槽的 `<Subject N>` 用同一个词。`media_refs` 有 video1 时，retention_analysis 的 `<Video 1>` 行必须有且只有一个关系词：fully_preserved、partially_preserved、attribute_transfer、weak_reference，并与 instruction 的用法一致。有 audio1 时，`<Audio 1>` 行必须有且只有一个关系词：fully_copy、partially_copy、reference、weak_reference，并与 instruction 一致。没有对应文件却写出 `<Video N>` 或 `<Audio N>`，判不合格。
3. 对照制作规则：`prompt` 六段正文应为英文；须另有非空 `prompt_zh` 简体中文对照。单一连续摄影镜头。`[Shot N] At` 是同一条镜头里的时间段，单独出现不算切镜；写出切镜、反打、跨场景、时间跳跃或蒙太奇才判不合格。每一段要有景别、主体位置、环境光线、动作、运镜、该段声音和参考生效位置。定义句要写来源、作用和可见特征，不把动作和对白写进定义段。summary 不复述素材清单。开口必须是主体标签、说话人编号、语气和 `<d>[Chinese]` 或对应语言全称，禁止 zh、en、ja、ko、zh-CN。多人齐声用 `(S1,S2)` 和一个 `<d>`。声音两段不重复整句台词。overall_soundscape 只写全片一直在的环境层；某一秒才开始的声音写进对应镜头，不写进这一段。partially_copy 的声音在开始前的镜头里出现，或文件时间未对齐却用 fully_copy，判不合格。有配乐时写乐器、速度和强弱，没有配乐时 non_diegetic_music 写 N/A。director_requirements 只追加不放宽编剧要求；正面 prompt 无否定写法；情绪/风格拆成可拍摄事实。`allowed_variant_changes` 不是当前外形。正面成片另检四项（命中任一项 → rejected，需改方向写可见正向事实，勿给整段改写稿）：① 伪正向排除（「留在图内 / 不入画 / 其余…留…」或「只留 / 只有 X」收窄音轨或排除画面；相对强弱如「风声退到很轻」不算）；② 禁忌名入正面（点名要禁的概念，即使未写否定词）；③ 拼版元结构入成片（格线、其余格、拼版边框）；④ 画面外事实写入本镜正面；⑤ 堆砌空词或施工清单；⑥ 出现 Negative Prompt 标题或把禁忌名写入唯一正面段；⑦ 多格/拼版用「其余格不要」而非逐格正向（见 `common.md`）。
3b. **开场站位与第一拍**：若 prepare 标明本镜是场次/空间第一镜，站位须与 continuity_in 一致；钩子镜第一拍须有主体运动（静物特写当唯一开场钩子 → rejected）。**退出状态**：prompt 时间线末段可见状态须能支撑 continuity_out，不得无动作凭空改持物/位置。跨镜锁面事实若在 approved 资产或规划中标出，须出现在 Subject 定义或 retention_analysis，不得因「参考帧已有」省略。
4. 不改写 prompt，不改槽位。不合格退回 video-director。

### 文生视频输出与交接
只返回 `video_prompt_review`。合格：status=ok，findings 必须 []。不合格：status=rejected，findings 含整改意见。缺原文或准备结果：公共 blocked。总控把 rejected 退回 video-director；status=ok 后将 director 与 review 一起 POST `/shots/prompt`。提示词工不提交 sidecar。开 GPU 仍由总控另行确认。
