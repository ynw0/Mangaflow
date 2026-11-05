import { z } from "zod";

export const templateTags = {
  scene: ["对话", "质问", "谈判", "告别", "揭示", "调查", "反转", "反应", "危险逼近", "登场", "追逐", "撤离", "格挡", "战斗", "救援", "交接", "觉醒", "施法", "机械变形", "装置启动", "场景建立", "转场", "灾变", "战后余波"],
  emotion: ["平静", "亲密", "克制", "犹豫", "惊疑", "震惊", "压迫", "紧张", "恐惧", "愤怒", "决绝", "焦急", "震撼", "兴奋", "哀伤", "释然", "孤独", "失控", "希望"],
  performance: ["视线转移", "沉默反应", "对话口型", "手部微动作", "呼吸变化", "身体后撤", "重心转移", "短暂停顿", "双人距离", "群体反应", "闭口克制"],
  action: ["递交", "持握", "松手", "步行", "奔跑", "越障", "转向", "碰撞", "受力", "闪避", "挥砍", "格挡", "坠落", "救援拉拽", "折叠", "伸缩", "滑移", "旋转", "锁定", "装配", "破裂", "落地", "状态承接"],
  effect: ["能量汇聚", "脉冲", "火花", "焊光", "冲击波", "爆裂", "电弧", "火焰", "烟尘", "雨水", "水柱", "碎片", "粒子", "能量束", "护盾", "结冰", "腐蚀", "空间扭曲", "熄灭", "消散", "局部反光", "形变"],
  camera: ["固定机位", "侧向跟拍", "向前跟随", "缓慢推进", "缓慢拉开", "横移揭示", "向上摇", "向下摇", "焦点转移", "低机位", "高机位", "肩后视点", "主观视点"],
  composition: ["特写", "中近景", "中景", "中全景", "全景", "双人同框", "三层景深", "负空间", "遮挡揭示", "接触点可见", "镜尾定幅"],
  lighting: ["逆光", "剪影", "局部亮区", "冷暖对照", "轮廓光", "低照度", "自然侧光", "实景灯", "动态反光", "湿面反射"],
  sound: ["对白", "环境底声", "接触同期声", "画外声", "声音先行", "脚步", "金属声", "呼吸", "雨声", "水声", "静默", "低频余震"],
  setting: ["室内", "室外", "街道", "桥面", "走廊", "工厂", "战场", "水域", "车内", "舞台", "夜景", "雨天", "狭窄空间", "开阔空间"],
} as const;

export const templateFormats = ["h3Ref2va", "h3Frames", "h3Text"] as const;
export const templateAnchors = ["底图", "末态图", "接触对象", "障碍物", "入口", "可见光源", "可变形零件", "水面", "可见受力表面", "可揭示物件"] as const;

export const templateTagSchema = z.strictObject({
  scene: z.array(z.enum(templateTags.scene)).min(1).optional().describe("剧情用途，可选多项"),
  emotion: z.array(z.enum(templateTags.emotion)).min(1).optional().describe("要表达的情绪，可选多项"),
  performance: z.array(z.enum(templateTags.performance)).min(1).optional(),
  action: z.array(z.enum(templateTags.action)).min(1).optional(),
  effect: z.array(z.enum(templateTags.effect)).min(1).optional(),
  camera: z.array(z.enum(templateTags.camera)).min(1).optional(),
  composition: z.array(z.enum(templateTags.composition)).min(1).optional(),
  lighting: z.array(z.enum(templateTags.lighting)).min(1).optional(),
  sound: z.array(z.enum(templateTags.sound)).min(1).optional(),
  setting: z.array(z.enum(templateTags.setting)).min(1).optional(),
});

export const templateConditions = z.strictObject({
  duration: z.number().positive().optional(),
  format: z.enum(templateFormats).optional(),
  imageCount: z.number().int().min(0).optional(),
  subjectCount: z.number().int().min(0).optional(),
  anchors: z.array(z.enum(templateAnchors)).optional().describe("已核实可用的画面条件，省略时只提示所需条件"),
});

export type VideoPromptTags = z.infer<typeof templateTagSchema>;
export type TemplateConditions = z.infer<typeof templateConditions>;

export type VideoPromptTemplate = {
  id: string;
  title: string;
  tags: VideoPromptTags;
  minSeconds: number;
  minImages?: number;
  minSubjects?: number;
  formats?: (typeof templateFormats)[number][];
  anchors?: (typeof templateAnchors)[number][];
  useWhen: string;
  fragment: string;
  avoid: string;
  verify: string;
};
