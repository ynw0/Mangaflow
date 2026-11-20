import { realpath } from "@toonflow/file";
import { z } from "zod";
import type { MediaGenerationRequest, QcRequirement } from "@toonflow/tools-scaffold/runtime";
import { readApprovedVideoReview } from "@/utils/production/videoReviews";
import { cinematicPlanSchema } from "@/utils/production/videoPlan";
import { readDialogueBlocks } from "@/agent/videoPrompt/dialogue";

const shotSchema = z.object({
  story: z.string().trim().min(1), mustHave: z.array(z.string().trim().min(1)), mustNotHave: z.array(z.string().trim().min(1)),
  continuityIn: z.string(), continuityOut: z.string(),
  lockedDialogue: z.array(z.string()).optional(),
});

// 提示词审核与成片质检共用合同编号，保持要求原文和来源一致。
export function getShotRequirements(shot: z.infer<typeof shotSchema>): QcRequirement[] {
  return [
    { id: "story", source: "story", text: shot.story },
    ...shot.mustHave.map((text, index) => ({ id: `mustHave.${index}`, source: `mustHave[${index}]`, text })),
    ...shot.mustNotHave.map((text, index) => ({ id: `mustNotHave.${index}`, source: `mustNotHave[${index}]`, text: `禁止出现：${text}` })),
    ...["continuityIn", "continuityOut"].flatMap(source => {
      const text = shot[source as "continuityIn" | "continuityOut"].trim();
      return text ? [{ id: source, source,
        text: `承接状态：${text}。明确要求可见或可听的事实须逐项核对，画外延续的状态只检查已有声画是否与它冲突。` }] : [];
    }),
  ];
}

export async function readQcRequirements(directory: string, request?: MediaGenerationRequest): Promise<QcRequirement[]> {
  if (!request?.reviewId) return [];
  const review = await readApprovedVideoReview(request.reviewId);
  const root = await realpath(directory);
  if (request.providerId !== "comfyui" || review.snapshot.directory !== (process.platform === "win32" ? root.toLowerCase() : root)
    || review.snapshot.prompt !== request.prompt) {
    throw new Error("成片生成记录与审核合同不一致，无法进行剧情验收");
  }
  const shot = shotSchema.parse(review.audit.shot);
  const plan = review.audit.cinematicPlan === undefined ? undefined : cinematicPlanSchema.parse(review.audit.cinematicPlan);
  // 台词从已锁定合同取得，早期审核记录以当时审核的对白为准。计划秒数仅供定位。
  const dialoguePlan = plan?.dialogue;
  const lines = shot.lockedDialogue ?? (dialoguePlan ? readDialogueBlocks(review.snapshot.prompt).map(block => block[1]!) : []);
  if (dialoguePlan && dialoguePlan.length !== lines.length) {
    throw new Error("已审对白计划与台词段数不一致，无法核对成片");
  }
  const dialogue = lines.map((text, index): QcRequirement => {
    const timing = dialoguePlan?.[index];
    const cue = timing ? `说话人 ${timing.speakerIds.join("、")}，可在 ${timing.startSeconds}–${timing.endSeconds} 秒附近查找。` : "";
    return {
      id: `dialogue.${index}`,
      source: shot.lockedDialogue ? `lockedDialogue[${index}]` : `prompt.dialogue[${index}]`,
      domain: "audio",
      text: `核对说话人、原话及其完整性。原台词：${text}。${cue}`,
    };
  });
  // 用户确认的表演、运镜和镜尾约束已在镜头合同中，导演计划不再额外生成验收项。
  return [...getShotRequirements(shot), ...dialogue];
}
