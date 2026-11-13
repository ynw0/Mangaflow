import { z } from "zod";

const text = z.string().trim().min(1).max(1200);
const dialogueLineSchema = z.strictObject({
  speakerIds: z.array(z.string().regex(/^S[1-9]\d*$/)).min(1).max(12)
    .refine(ids => new Set(ids).size === ids.length, "同一句对白的说话人编号不得重复")
    .describe("与正文当前 <d> 前的说话人编号顺序一致；齐声共用一条记录"),
  startSeconds: z.number().finite().nonnegative().describe("这句实际计划开口的镜内秒数"),
  endSeconds: z.number().finite().positive().describe("这句必须完整说完的镜内秒数"),
  pauseSeconds: z.number().finite().nonnegative().describe("计划留给句内停顿的总秒数；无需停顿填 0"),
  afterBeat: z.number().int().positive().optional()
    .describe("只有动作必须完成后才能开口时填写对应 beats 的序号，从 1 开始"),
});

export const cinematicPlanSchema = z.object({
  openingFrame: text,
  camera: z.object({ movement: text, stopSeconds: z.number().finite().nonnegative().nullable() }),
  ending: z.object({ composition: text, visible: z.array(text).min(1).max(8), holdSeconds: z.number().finite().nonnegative() }),
  beats: z.array(z.object({ startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive(), action: text, performance: text })).min(1).max(8),
  // 历史审核记录保留当时的规划；新稿通过下方的必填规则。
  dialogue: z.array(dialogueLineSchema).max(32).describe("按英文正文 <d> 出现顺序逐句填写；无对白填空数组").optional(),
});
export const draftCinematicPlanSchema = cinematicPlanSchema.required({ dialogue: true });
export type DraftCinematicPlan = z.infer<typeof draftCinematicPlanSchema>;

export function inspectVideoPlan(plan: z.infer<typeof cinematicPlanSchema>, duration: number) {
  const findings: string[] = [];
  if (plan.ending.holdSeconds > duration) findings.push("镜尾保持时长不能超过镜头总时长。");
  if (plan.camera.stopSeconds !== null && plan.camera.stopSeconds > duration) findings.push("运镜停止时间超过镜头结束时间。");
  // 定幅必须在运镜结束后开始；持续运镜的镜头允许 holdSeconds=0。
  if (plan.ending.holdSeconds > 0 && (plan.camera.stopSeconds === null || plan.camera.stopSeconds > duration - plan.ending.holdSeconds)) {
    findings.push("镜尾要求保持定幅，但运镜未在保持区间前结束。");
  }
  let previous = 0;
  for (const [index, beat] of plan.beats.entries()) {
    if (beat.startSeconds < previous || beat.endSeconds <= beat.startSeconds || beat.endSeconds > duration) findings.push(`表演节拍 ${index + 1} 的时间顺序或范围无效。`);
    previous = beat.startSeconds;
  }
  return findings;
}
