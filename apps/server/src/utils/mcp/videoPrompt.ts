import { mkdir, readFile, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { prepareVideoPrompt, videoPromptParameters, type VideoPromptInput } from "@/agent/videoPrompt/input";
import { createReviewSchema, draftSchema, getVideoPromptRequirements, inspectDraft } from "@/agent/videoPrompt/format";
import { getVideoSpeechPolicy } from "@/agent/videoPrompt/dialogue";
import { requireSameVideoReview, saveVideoReview } from "@/utils/production/videoReviews";
import { lockWorkspaceFiles } from "@/utils/workspace/files";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";

const fields = {
  input: videoPromptParameters,
  preparationId: z.uuid(),
  draft: draftSchema.options[0],
  review: z.record(z.string(), z.json()),
};
const videoPromptSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("prepare"), input: fields.input }),
  z.strictObject({ action: z.literal("inspect"), preparationId: fields.preparationId, draft: fields.draft }),
  z.strictObject({ action: z.literal("submit"), preparationId: fields.preparationId, draft: fields.draft, review: fields.review.optional() }),
]);
// 外部宿主直接读取 args 的字段；服务端执行时仍按操作校验参数组合。
export const videoPromptToolSchema = z.toJSONSchema(z.strictObject(fields).partial().extend({
  action: z.enum(videoPromptSchema.options.map(option => option.shape.action.value)),
}), { io: "input" });

const reviewer = "externalAgent";
type Preparation = {
  directory: string; input: VideoPromptInput; expires: number;
  prepared: Awaited<ReturnType<typeof prepareVideoPrompt>>;
  approved?: { draft: z.infer<typeof fields.draft>; review: unknown; result: Record<string, unknown> };
};

// 准备快照只保存在服务端，外部 Agent 不能自行声明素材版本或签发审核编号。
export async function externalVideoPrompt(directory: string, args: unknown, canvas?: CanvasContext, signal?: AbortSignal) {
  const input = videoPromptSchema.parse(args);
  const root = join(dirname(conf.path), "mcpVideoPrompts");
  if (input.action === "prepare") {
    const prepared = await prepareVideoPrompt(directory, input.input, canvas, signal);
    const preparationId = crypto.randomUUID();
    const expires = Date.now() + 30 * 60_000;
    await mkdir(root, { recursive: true });
    await writeAtomic(join(root, `${preparationId}.json`), JSON.stringify({ directory, input: input.input, expires, prepared }), { exclusive: true, mode: 0o600 });
    return { preparationId, expires, reviewer, shot: prepared.shot, format: prepared.format, workflow: prepared.setup,
      creativeTemplates: prepared.creativeContext,
      voiceCast: prepared.voiceContext.roles.length ? prepared.voiceContext : undefined,
      speechPolicy: getVideoSpeechPolicy(prepared.audioEnabled),
      expectedRevision: prepared.revision, reviewRequirements: getVideoPromptRequirements(prepared.shot),
      nextAction: "按照本次返回的 format 编写英文提示词及中文对照。h3Text 用三段，h3Ref2va 用六段，h3Frames 在三段前写首尾帧对齐。英文正文的台词用 <d>[Language] …</d>，方括号内写语言的英文全称，照录原话和标点。按照已确认的分镜，记录切换镜头的时刻、镜头结束时的状态以及对白开口的顺序。用 inspect 预检，warnings 供参考。使用同一个 preparationId 调用 submit 可取得生成请求；review 为可选字段，只有实际审核通过时才登记审核结果并返回 reviewId。也可直接写入视频节点，不要求审核号。" };
  }
  const path = join(root, `${input.preparationId}.json`);
  const release = lockWorkspaceFiles([path]);
  try {
    const saved = JSON.parse(await readFile(path, "utf8")) as Preparation;
    if (saved.directory !== directory) throw Object.assign(new Error("提示词准备记录不属于当前工作区"), { status: 403 });
    if (saved.expires <= Date.now()) throw Object.assign(new Error("提示词准备记录已过期，请重新 prepare"), { status: 409 });
    const current = await prepareVideoPrompt(directory, saved.input, canvas, signal);
    requireSameVideoReview(saved.prepared.snapshot, current.snapshot);
    if (saved.prepared.revision !== current.revision) throw Object.assign(new Error("节点已变化，请重新 prepare"), { status: 409 });
    const { findings, warnings } = inspectDraft(input.draft, current);
    if (input.action === "inspect") return { status: findings.length ? "rejected" : "ok", findings, warnings };
    if (findings.length) return { status: "rejected", findings, warnings };
    if (input.review === undefined) {
      const generationRequest = videoGenerationSchema.parse({ ...current.generationRequest, prompt: input.draft.prompt, reviewId: undefined });
      return { status: "ok", generationRequest, node: saved.input.node, expectedRevision: current.revision, written: false, warnings };
    }
    const review = createReviewSchema(getVideoPromptRequirements(current.shot).map(item => item.id)).parse(input.review);
    if (review.status === "rejected" && review.needsAdjacentShots) {
      return { status: "blocked", findings: review.findings, warnings, nextAction: "重新读取相关场次或镜头，将本镜所回应的原话或事件补充到 input.adjacentShots，再调用 prepare 并提交审核。" };
    }
    if (review.status !== "ok") return { status: "rejected", findings: review.findings, warnings };
    if (saved.approved) {
      if (!isDeepStrictEqual(saved.approved.draft, input.draft) || !isDeepStrictEqual(saved.approved.review, review)) {
        throw Object.assign(new Error("该准备记录已批准另一份稿件，请重新 prepare"), { status: 409 });
      }
      const reviewId = saved.approved.result.reviewId;
      const generationRequest = videoGenerationSchema.parse({ ...current.generationRequest, prompt: input.draft.prompt, reviewId });
      return { ...saved.approved.result, reviewer, generationRequest, expectedRevision: current.revision, warnings };
    }
    const generationRequest = videoGenerationSchema.parse({ ...current.generationRequest, prompt: input.draft.prompt });
    const reviewId = await saveVideoReview({ ...current.snapshot, prompt: input.draft.prompt }, {
      shot: current.shot, cinematicPlan: input.draft.cinematicPlan, promptZh: input.draft.promptZh,
      request: generationRequest, review, reviewer, preparationId: input.preparationId,
    });
    const result = { status: "ok", reviewId, reviewer, generationRequest: { ...generationRequest, reviewId },
      node: saved.input.node, expectedRevision: current.revision, written: false, warnings };
    saved.approved = { draft: input.draft, review, result };
    await writeAtomic(path, JSON.stringify(saved), { mode: 0o600 });
    return result;
  } finally { release(); }
}
