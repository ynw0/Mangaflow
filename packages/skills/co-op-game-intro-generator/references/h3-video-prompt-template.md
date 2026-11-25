# H3 Video Prompt Template

## Prompt principle
Use the same method as the GPT confirmation-image prompt:

**Fixed video event framework + dynamic user-style fill + locked character identity + palette-linked UI system.**

The video prompt must not blindly preserve the source prompt's default style. It must preserve the timeline, UI events, player positions, equipment logic, and text structure, while dynamically rewriting visual treatment, palette, character rendering, lighting, UI surface, icons, and city-world style according to the user's selected style.

## Priority order
1. User-selected style: {visual_style}
2. Confirmed image / UI reference: {ui_ref}
3. PLAYER 1 identity reference: {player1_ref}
4. PLAYER 2 identity reference: {player2_ref}
5. Height/body comparison reference: {height_ref}
6. Fixed source video event framework

## Reference roles
- {ui_ref}: confirmed first image. Use it to lock UI layout, menu hierarchy, color system, typography scale, button structure, character-game integration, and overall composition logic.
- {player1_ref}: PLAYER 1 identity anchor. Lock exact face, hairstyle, glasses if present, facial proportions, body identity, and nickname mapping to {player1_name}.
- {player2_ref}: PLAYER 2 identity anchor. Lock exact face, hairstyle, facial proportions, body identity, and nickname mapping to {player2_name}.
- {height_ref}: use the players' confirmed relative height and build if supplied. Otherwise follow the approved character images and confirmation frame.

## Global style baseline
整体画风必须优先服从用户选择：{visual_style}。
保留固定基准：游戏主菜单 UI、界面与角色自然融合且容易辨认、商业游戏菜单层级清楚、画面简洁干净、避免过度装饰。不要堆砌「极强视觉冲击力」「AAA」等缺少具体画面含义的质量描述。
其余视觉层面根据 {visual_style} 动态拓展：角色画风、表情气质、服装语言、色彩系统、灯光冷暖、UI材质、按钮图标、字体质感、城市加载后的世界风格。

## Palette system
根据 {visual_style} 推导视频全程色彩，但必须保持 UI 色彩联动：
- xx 色作为主体背景 / 世界主色
- xx 色作为 UI 主体颜色
- xx 色作为文字颜色
- xx 色作为功能强调色
- 红色作为危险/退出/警示提示色
- 整体颜色控制在 5 种以内
- 高对比撞色、鲜明现代、符合 {visual_style} 的色彩语言

视频中的菜单、装备面板、玩家卡、按钮、HUD、加载条、图标和文字都必须沿用同一色彩系统，不得随机新增无关颜色。

## Character identity and style lock
PLAYER 1 在左侧。脸、发型、体型与昵称 {player1_name} 沿用 {player1_ref}。服装和装备按已批准的确认图及构型。

PLAYER 2 在右侧。脸、发型、体型与昵称 {player2_name} 沿用 {player2_ref}。服装和装备按已批准的确认图及构型。

保持两人的脸、昵称、装备、相对体型和站位对应。

## Timeline framework（骨架，勿整段粘贴成稿）

按已确认时长填充分段；UI 文案、装备名与按钮字以确认图与用户批准为准，下列英文仅作占位示例。本模板是联机开场专用自由时间轴，**不等于**默认漫剧的 Ref2VA 画布合同；漫剧成片仍走 workflow。

### [开场段] — 双人主菜单
景别/机位：高角度俯拍大全景，延续 {ui_ref} 的构图逻辑。镜头从上方轻微下压并缓慢推进。

画面内容：PLAYER 1（{player1_name}）和 PLAYER 2（{player2_name}）并排坐在画面中央，PLAYER 1 在左，PLAYER 2 在右，抬头看向摄像机。两人保持已确认姿态与角色身份，出现与当前事件相符的细微呼吸或自然动作即可；无需逐秒安排眨眼、摆姿势或夸张表情。

UI结构：左上角玩家资料卡准确显示：
“PLAYER 1”
“{player1_name}”
“READY”
顶部中央或左上双卡系统中的第二张资料卡准确显示：
“PLAYER 2”
“{player2_name}”
“READY”
右侧纵向菜单准确显示：
“START NEW GAME”
“CONTINUE”
“SETTINGS”
“EXIT GAME”
“CONTINUE”是视觉中心和主高亮按钮。

动态风格填充：主菜单背景、地面纹理、按钮形态、图标、字体、边框、辉光和贴纸质感全部根据 {visual_style} 优化，但保留 {ui_ref} 的布局和层级。

声音：菜单环境音、轻微 UI hover 声、点击前的低频电子氛围。若生成无音频，则忽略声音执行。

### [配置段 1] — PLAYER 1 装备配置
景别/机位：中景，镜头从主菜单平滑推近 PLAYER 1 的右臂，PLAYER 2 仍在背景中可见，不消失、不变形。

UI结构：右侧菜单滑出，玩家一装备面板滑入。使用已确认的界面标题和装备原名，从当前选择过渡到批准的目标装备。未确认名称时保留可辨的选中状态。

动作：从已确认的原装备过渡到玩家一选择的右臂配置。保留装备结构中实际存在的连接点和最终状态，让观众看清完成了哪项配置。

动态风格填充：按 {visual_style} 处理已确认装备和界面材质，沿用角色原有体型与服装。

声音：精密机械展开声、轻快 UI 切换音、细小锁定声。

### [配置段 2] — PLAYER 2 装备配置
景别/机位：中景，摄影机沿两人之间平滑横移并绕向 PLAYER 2 左侧。PLAYER 1 留在背景中，轻轻观察自己完成配置的机械手。

UI结构：玩家二面板使用确认图的强调色，显示已批准的标题和组件标签。

动作：按照玩家二已确认装备的装配关系，清楚呈现装备更换过程及最终锁定的结果。

动态风格填充：用已确认的装备造型、颜色和实际安装部位区分两位玩家。

声音：低沉电机声、重型机械扣合声、厚重的机械锁定声。

### [确认段] — 双人确认配置
景别/机位：中景拉回，镜头平滑回到双人构图，PLAYER 1 左侧，PLAYER 2 右侧。

UI结构：两组装备面板向画面中央汇合，形成共享确认按钮；按钮文字用已批准文案（勿默认照抄 CONFIRM CONFIG）。按钮边框、辉光、图标和贴纸质感根据 {visual_style} 优化，但层级清晰、文字可读。

动作：光标确认两人的配置，界面给出已确认的反馈。两人的反应按分镜写，保留对应装备。

声音：确认提示音、双色能量脉冲、UI 收缩声。

### [加载段] — 双人世界加载
景别/机位：全景，底部共享加载条出现。

UI结构：加载条显示已批准的加载文案（勿默认照抄 LOADING）。进度从 0% 到 100%。左半段使用 PLAYER 1 的功能强调色，右半段使用 PLAYER 2 的强调色。HUD 和加载条的形态、边框、纹理、字体根据 {visual_style} 优化，但必须清晰可读。

环境转化：从确认图的现有空间、颜色和图形过渡到已批准的游戏环境。保留地面或背景中的参照物，让观众能够看清场景转换过程。

关键约束：转化必须连续自然，不使用硬切，不用烟雾遮挡，不改变两位角色身份。

声音：加载上升音、环境从菜单氛围过渡到城市氛围。

### [进入世界段] — 双人进入游戏世界
景别/机位：大全景转第三人称跟拍。加载 100% 的瞬间，两名角色同时起身。摄影机平滑下降并绕到两人身后，变成稳定第三人称双人合作视角。

世界风格：按已批准的游戏地点、世界设定和 {visual_style} 写环境。写出玩家接下来实际要去的方向。

角色关系：保持两位玩家的相对位置、体型与装备，按分镜进入目标游戏场景。

HUD结构：HUD 淡入。右上角出现小地图；左下角出现两组独立状态栏：“{player1_name}”“{player2_name}”。{player1_name} 状态栏使用 PLAYER 1 功能强调色，{player2_name} 状态栏使用 PLAYER 2 暖色/力量色。前方街道中央出现共享任务标记。

声音：城市环境氛围、远处载具声、脚步声、HUD 淡入提示音。

## Negative constraints
Keep the two approved players and their identity, clothing, equipment and nickname mapping. Use only approved on-screen text and logos. Preserve the confirmed transitions and composition.
