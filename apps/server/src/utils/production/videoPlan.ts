import { z } from "zod";

const text = z.string().trim().min(1).max(1200);
const dialogueLineSchema = z.strictObject({
  speakerIds: z.array(z.string().regex(/^S[1-9]\d*$/)).min(1).max(12)
    .refine(ids => new Set(ids).size === ids.length, "同一句对白的说话人编号不得重复")
    .describe("与正文当前 <d> 前的说话人编号顺序一致；齐声共用一条记录"),
  startSeconds: z.number().finite().nonnegative().describe("这句实际计划开口的镜内秒数"),
  endSeconds: z.number().finite().positive().describe("本段发声计划收句或按剧本被打断的片段内秒数"),
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
  continuityIn: text.optional().describe("有必要时说明承接上一镜的主体位置、持物、光声或时间状态"),
  continuityOut: text.optional().describe("有必要时说明交给下一镜的实际状态，保留画外人物或物件的位置和关系"),
});

export const cinematicPlanSchema = z.object({
  openingFrame: text,
  camera: z.object({ movement: text, stopSeconds: z.number().finite().nonnegative().nullable() }),
  ending: z.object({ composition: text, visible: z.array(text).min(1).max(8).describe("当前镜尾构图实际拍到的内容，包括空场；仅在画外延续的状态留在 continuityOut"), holdSeconds: z.number().finite().nonnegative() }),
  beats: z.array(z.object({ startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive(), action: text, performance: text })).min(1).max(8),
  // 历史审核记录保留当时的规划；新稿通过下方的必填规则。
  dialogue: z.array(dialogueLineSchema).max(32).describe("按英文正文 <d> 出现顺序逐句填写；无对白填空数组").optional(),
  shots: z.array(cinematicShotSchema).min(1).max(20).optional()
    .describe("新多镜提示词按 [Shot N] 填写每个内部镜头；历史单镜或旧审核记录可省略。全局 beats/dialogue 仍使用整段视频的绝对秒数。"),
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
