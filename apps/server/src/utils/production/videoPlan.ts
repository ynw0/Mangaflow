import { z } from "zod";

const text = z.string().trim().min(1).max(1200);
export const cinematicPlanSchema = z.object({
  openingFrame: text,
  camera: z.object({ movement: text, stopSeconds: z.number().finite().nonnegative().nullable() }),
  ending: z.object({ composition: text, visible: z.array(text).min(1).max(8), holdSeconds: z.number().finite().nonnegative() }),
  beats: z.array(z.object({ startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive(), action: text, performance: text })).min(1).max(8),
});
export type CinematicPlan = z.infer<typeof cinematicPlanSchema>;

export function inspectVideoPlan(plan: CinematicPlan, duration: number) {
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
