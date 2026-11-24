import { z } from "zod";

// 锁词与导演计划逐段对应，共用段数上限。
export const maxVideoDialogueLines = 64;

const text = z.string().trim().min(1).max(1200);
const dialogueLineSchema = z.strictObject({
  speakerIds: z.array(z.string().regex(/^S[1-9]\d*$/)).min(1).max(12)
    .refine(ids => new Set(ids).size === ids.length, "同一句对白的说话人编号不得重复")
    .describe("与正文中对应 <d> 前的说话人编号及顺序一致；多人齐声说同一句话时共用一条记录"),
  startSeconds: z.number().finite().nonnegative().describe("计划在这段视频中的第几秒说出这句台词"),
  endSeconds: z.number().finite().positive().describe("计划在这段视频中的第几秒说完这句台词，或按剧本被打断"),
  pauseSeconds: z.number().finite().nonnegative().describe("计划留给句内停顿的总秒数；无需停顿填 0"),
  afterBeat: z.number().int().positive().optional()
    .describe("只有动作必须完成后才能开口时填写对应 beats 的序号，从 1 开始"),
});

/** Optional per-cut plan. Existing cinematicPlan fields remain the whole-clip summary and
 * timing source for beats and dialogue; old saved reviews can omit shots entirely.
 */
export const cinematicShotSchema = z.strictObject({
  id: z.number().int().min(1).max(99).describe("H3 [Shot N] 中的 N，从1开始连续编号"),
  startSeconds: z.number().finite().nonnegative().describe("本段视频内的绝对开始时间；第一镜为0"),
  endSeconds: z.number().finite().positive().describe("本段视频内的绝对结束时间；相邻镜头时间连续"),
  camera: text.describe("本镜实际机位、构图与运镜；不是全片统一运镜"),
  action: text.describe("本镜可观察的动作与表演结果，不额外增加剧情"),
  continuityIn: text.optional().describe("有必要时说明需要延续上一镜的主体位置、手中物件、光线、声音或时间状态"),
  continuityOut: text.optional().describe("有必要时说明下一镜需要延续的实际状态，包括画外人物或物件的位置和相互关系"),
});

export const cinematicPlanSchema = z.object({
  openingFrame: text,
  camera: z.object({ movement: text, stopSeconds: z.number().finite().nonnegative().nullable() }),
  ending: z.object({
    composition: text,
    visible: z.array(text).min(1).max(8).describe("记录对剧情和下一镜的衔接有影响、且在本镜结束时实际拍到的主体或状态。没有人物的镜头应记录实际可见的场地。画外状态沿用 continuityOut"),
    holdSeconds: z.number().finite().nonnegative().describe("镜头达到要求的结束构图后，需要保持该构图的秒数。摄影机可以先停止移动，让人物继续完成最后的动作"),
  }),
  beats: z.array(z.object({
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
    action: text,
    performance: text.optional().describe("记录本段确有必要交代的语气、反应或表演安排。沿用原动作或普通接话时可省略"),
  })).min(1).max(8),
  // 历史审核记录保留当时的规划；新稿通过下方的必填规则。
  dialogue: z.array(dialogueLineSchema).max(maxVideoDialogueLines).describe("按英文正文 <d> 出现顺序逐句填写；无对白填空数组").optional(),
  shots: z.array(cinematicShotSchema).max(20).optional()
    .describe("新的多镜头提示词按 [Shot N] 逐个填写内部镜头。单镜可省略或填空数组，旧审核记录也可省略。全局 beats/dialogue 使用整段视频的绝对秒数。"),
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
  if (plan.shots?.length) {
    const epsilon = 0.001;
    let expectedStart = 0;
    for (const [index, shot] of plan.shots.entries()) {
      if (shot.id !== index + 1) {
        findings.push(`cinematicPlan.shots[${index}] 的 id 应为 ${index + 1}，与 [Shot N] 顺序一致。`);
      }
      if (Math.abs(shot.startSeconds - expectedStart) > epsilon) {
        findings.push(`cinematicPlan.shots[${index}] 起点应为 ${expectedStart} 秒，内部镜头不能重叠或留下时间空隙。`);
      }
      if (shot.endSeconds <= shot.startSeconds || shot.endSeconds > duration + epsilon) {
        findings.push(`cinematicPlan.shots[${index}] 时间范围无效，必须处于视频时长内且结束晚于开始。`);
      }
      expectedStart = shot.endSeconds;
    }
    if (Math.abs(expectedStart - duration) > epsilon) {
      findings.push(`cinematicPlan.shots 最后一镜必须覆盖到视频结束 ${duration} 秒。`);
    }
  }
  return findings;
}
