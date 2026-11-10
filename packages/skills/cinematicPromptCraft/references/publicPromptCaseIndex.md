# 公开可追溯提示词案例索引（只提炼技法，不复制长提示词）

版本 1.0.0 / 2026-11-10。此索引汇集网页上能看到原提示词或生成示例的条目。指向官方页面/模型供应商教程，便于继续查看。**已公开案例不等于已在 MangaFlow 本地 H3、当前工作流和参数下复现。**

## 检索规范
单镜根据 intent / movement / dialogue / transformation / product / physical_effect 选取 0–2 条。优先 A（模型开发商官方）再考虑 B（供应商公开演示）。不从网页复制整段原稿；只借鉴已公开的技术思路，转写成当镜自有表达。所有真实案例来自别的模型或托管环境时，标注 portability=needs_H3_test。用户已锁定剧情和外观时，以用户资产优先。

## 真实公开案例

### P01｜沙漠机械公牛：跟拍与沙尘拖尾
- source: Runway Gen-4 官方视频提示指南（A） https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide
- observable: 示例提示词让手持摄影机跟着沙漠里奔跑的机械公牛，并让运动产生拖尾沙尘；页面提供输入图与结果预览。
- extract: 主体运动 + 单一跟拍 + 可见环境反应；可借鉴给高速驾驶、车辆追逐，但不能照搬机械公牛外形。
- limitation: Runway 的视频模型，需验证本机 H3；不代表所有参考图均保持身份。

### P02｜镜面气泡：静态机位的局部异常
- source: Runway Gen-4 官方视频提示指南（A） https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide
- observable: 女子检查镜子时，镜面以不同大小的透明泡状隆起；指定锁定机位，官方提供示例输出。
- extract: 把特效作用限制在既定介质，减少运镜竞争；适用实验室异常、系统觉醒、道具通电。
- limitation: 其光学形变不能直接等同于物理可解释的机械变形。

### P03｜岩石人形变化：材质由起点带向终点
- source: Runway Gen-4 官方视频提示指南（A） https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide
- observable: 一堆岩石变成岩质人形并走动，有页面提供的输入图与动图结果。
- extract: 先定义“来自哪里”的材料来源，再描述形成和随后移动的次序。
- limitation: 自由形变适合超自然目标；MangaFlow 机械变形必须额外补铰链、导轨、部件数和身份约束。

### P04｜老水手独白：声画主体一致
- source: Google DeepMind Veo 官方提示指南（A） https://deepmind.google/models/veo/prompt-guide/
- observable: 水手中景，手中烟斗手势、海面背景、可听独白，官方给提示词和演示视频。
- extract: 同时说明人物可见特征、手的动作、说话文本与环境，让“发声者是谁”可追踪。
- limitation: H3 Ref2VA 仍需 <Subject N> (Sx) 和 <d>[Language] ...</d>，不可直接复制 Veo 的自由对白句法。

### P05｜越野过河：运动的先后因果
- source: Google DeepMind Veo 官方提示指南（A） https://deepmind.google/models/veo/prompt-guide/
- observable: 前车先冲进水面掀起泥水障碍，后车紧跟冲过；提示词明确水、石块、悬架与动力声音，演示视频可在源页查看。
- extract: 前车事件 → 产生遮挡 → 后车穿越 → 可见落地，事件的物理反馈让动作可信。
- limitation: 该例包含复杂多主体负荷，若 MangaFlow 单镜仅 5 秒，应拆成“障碍形成”“穿越障碍”等相邻镜头，绝不在一条提示词内切镜。

### P06｜废弃泳池：慢推中的线索显现
- source: fal.ai MiniMax H3 供应商示例（B） https://fal.ai/learn/tools/minimax-h3-explained
- observable: 以一镜连续缓慢推进空泳池，墙面凝结水汽形成可读线索文字，配合滴水和灯具声；页面标注由 H3 生成。
- extract: 先让空间稳定，再让微小证据浮现；声景不必随每个变化大幅增强。
- limitation: 供应商演示不保证本机 Qwen 原画文字与本机 H3 复现一致。

### P07｜餐馆环绕揭示：观众晚于场内人物知情
- source: fal.ai MiniMax H3 供应商示例（B） https://fal.ai/learn/tools/minimax-h3-explained
- observable: 摄影机持续绕普通餐馆运动，旋到窗前才显露非常规窗外景观，随后回到原起幅；原文与视频公开。
- extract: 用遮挡与机位路径延迟揭示，不靠字幕解释；空间必须真实容纳运镜。
- limitation: 样例设计 15 秒环绕；不得压成 MangaFlow 常见 5 秒镜头而强迫高速 360 度转圈。必要时只迁移“遮挡后揭示”的拍法。

### P08｜咖啡冲煮产品片：表面细节与同步音效
- source: fal.ai MiniMax H3 供应商示例（B） https://fal.ai/learn/tools/minimax-h3-explained
- observable: 玻璃滤杯的产品演示，细节涉及水线、咖啡液滴、蒸汽、容器声学和高光维持；供应商页面提供样例。
- extract: 物体身份锁 + 操作点 + 材质反光 + 与动作同步的声音。
- limitation: 公开样例有镜头剪切与 12 秒分段；MangaFlow 单镜场景只可借鉴其中一个连续段，不能借鉴跨镜切换。

### P09｜MiniMax H3 官方多模态模式案例目录
- source: MiniMax-AI 官方仓库（A） https://github.com/MiniMax-AI/MiniMax-H3
- observable: 官方提供 T2VA、FL2VA、Ref2VA 的 prompt writing skill、参考标签规则与示例，不是“所有模式能自动保留末帧”的保证。
- extract: 首帧/尾帧/参考图用途分清，六段式与 speaker 绑定严格按官方规则，避免把普通 Reference Image 当成精确关键帧。
- limitation: 官方文档中的多镜头示例不等于 MangaFlow 允许多摄影镜头；项目一视频节点一镜约束优先。

## 反馈
选用公开案例时记 public_id 与 original_case_id，并单独标注“外部公开来源/未在本地复现”。真正量化提升须持有相同工作流与相同素材的 A/B 视频、prompt、模型、设置和成片 QC 观察。不得凭文本评价填写成功率。
