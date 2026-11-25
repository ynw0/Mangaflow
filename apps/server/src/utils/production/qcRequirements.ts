import { realpath } from "@toonflow/file";
import { z } from "zod";
import { videoQcContractSchema, type MediaGenerationRequest, type QcRequirement } from "@toonflow/tools-scaffold/runtime";
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
        text: `需要延续的状态：${text}。对明确要求看到或听到的事实逐项核对。对于在画外延续的状态，只检查实际画面和声音是否与之冲突。` }] : [];
    }),
  ];
}

// 历史节点未迁移合同前，审核记录只用于读取原剧情；正文变化不能沿用旧审核结论或时间定位。
export function legacyQcContext(root: string, request: MediaGenerationRequest,
  review: Pick<Awaited<ReturnType<typeof readApprovedVideoReview>>, "snapshot" | "audit"> | undefined) {
  if (!review || request.providerId !== "comfyui"
    || review.snapshot.directory !== (process.platform === "win32" ? root.toLowerCase() : root)) return undefined;
  const shot = shotSchema.safeParse(review.audit.shot);
  if (!shot.success) return undefined;
  const plan = cinematicPlanSchema.safeParse(review.audit.cinematicPlan);
  return { shot: shot.data, dialoguePlan: plan.success && review.snapshot.prompt === request.prompt
    && (request.duration === undefined || review.snapshot.parameters.duration === request.duration) ? plan.data.dialogue : undefined };
}

export async function readQcRequirements(directory: string, request?: MediaGenerationRequest): Promise<QcRequirement[]> {
  if (!request) return [];
  // 新节点直接保存已确认的镜头合同，无需独立审核或额外记录编号。
  let shot: z.infer<typeof shotSchema> | undefined = request.qcContract && videoQcContractSchema.parse(request.qcContract);
  let dialoguePlan: z.infer<typeof cinematicPlanSchema>["dialogue"] | undefined;
  if (!shot && request.reviewId) {
    const review = await readApprovedVideoReview(request.reviewId).catch(() => undefined);
    const root = await realpath(directory);
    const legacy = legacyQcContext(root, request, review);
    shot = legacy?.shot;
    dialoguePlan = legacy?.dialoguePlan;
  }
  // 无合同或旧审核已失效时，以实际生成正文为验收依据，不冒充已确认的剧情。
  const promptLines = readDialogueBlocks(request.prompt).map(block => block[1]!.replace(/^\s*\[[^\]]+\]\s*/, "").trim());
  const lines = shot?.lockedDialogue ?? (request.generateAudio === false ? [] : promptLines);
  if (dialoguePlan?.length !== lines.length) dialoguePlan = undefined;
  const dialogue = lines.map((text, index): QcRequirement => {
    const timing = dialoguePlan?.[index];
    const cue = timing ? `说话人 ${timing.speakerIds.join("、")}，可在 ${timing.startSeconds}–${timing.endSeconds} 秒附近查找。` : "";
    return {
      id: `dialogue.${index}`,
      source: shot?.lockedDialogue ? `lockedDialogue[${index}]` : `prompt.dialogue[${index}]`,
      domain: "audio",
      text: `核对说话人、原话及其完整性。原台词：${text}。${cue}`,
    };
  });
  // 用户确认的表演、运镜和镜尾约束已在镜头合同中，导演计划不再额外生成验收项。
  const visual: QcRequirement[] = shot ? getShotRequirements(shot) : request.prompt.trim() ? [{ id: "prompt.visual", source: "prompt", domain: "video", text: "仅核对以下实际生成提示词中的可见事实、动作、构图与连续性：\n" + request.prompt }] : [];
  return [...visual, ...dialogue];
}
