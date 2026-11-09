import { realpath } from "@toonflow/file";
import { z } from "zod";
import type { MediaGenerationRequest, QcRequirement } from "@toonflow/tools-scaffold/runtime";
import { readApprovedVideoReview } from "@/utils/production/videoReviews";
import { cinematicPlanSchema } from "@/utils/production/videoPlan";

const shotSchema = z.object({
  story: z.string().trim().min(1), mustHave: z.array(z.string().trim().min(1)), mustNotHave: z.array(z.string().trim().min(1)),
  continuityIn: z.string(), continuityOut: z.string(),
});

export async function readQcRequirements(directory: string, request?: MediaGenerationRequest): Promise<QcRequirement[]> {
  if (!request?.reviewId) return [];
  const review = await readApprovedVideoReview(request.reviewId);
  const root = await realpath(directory);
  if (request.providerId !== "comfyui" || review.snapshot.directory !== (process.platform === "win32" ? root.toLowerCase() : root)
    || review.snapshot.modelId !== request.modelId || review.snapshot.prompt !== request.prompt) {
    throw new Error("成片生成记录与审核合同不一致，无法进行剧情验收");
  }
  const shot = shotSchema.parse(review.audit.shot);
  const plan = review.audit.cinematicPlan === undefined ? undefined : cinematicPlanSchema.parse(review.audit.cinematicPlan);
  // 直接保留已审合同的原文与来源，不让 QC 模型自行删减或改写验收范围。
  return [
    { id: "story", source: "story", text: shot.story },
    ...shot.mustHave.map((text, index) => ({ id: `mustHave.${index}`, source: `mustHave[${index}]`, text })),
    ...shot.mustNotHave.map((text, index) => ({ id: `mustNotHave.${index}`, source: `mustNotHave[${index}]`, text: `禁止出现：${text}` })),
    ...["continuityIn", "continuityOut"].flatMap(source => {
      const text = shot[source as "continuityIn" | "continuityOut"].trim();
      return text ? [{ id: source, source, text }] : [];
    }),
    ...(plan ? [
      { id: "cameraPlan", source: "cinematicPlan.camera", text: `运镜：${plan.camera.movement}；${plan.camera.stopSeconds === null ? "持续运动至镜尾" : `${plan.camera.stopSeconds} 秒后停止运镜`}。` },
      { id: "endingComposition", source: "cinematicPlan.ending.composition", text: `镜尾构图：${plan.ending.composition}；保持 ${plan.ending.holdSeconds} 秒。` },
      ...plan.ending.visible.map((text, index) => ({ id: `endingVisible.${index}`, source: `cinematicPlan.ending.visible[${index}]`, text: `镜尾必须留在画内：${text}` })),
      ...plan.beats.map((beat, index) => ({ id: `performance.${index}`, source: `cinematicPlan.beats[${index}]`, text: `${beat.startSeconds}–${beat.endSeconds} 秒：${beat.action}；表演：${beat.performance}` })),
    ] : []),
  ];
}
