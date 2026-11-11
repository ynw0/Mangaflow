import { mkdir, readFile, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { prepareVideoPrompt, videoPromptParameters, type VideoPromptInput } from "@/agent/videoPrompt/input";
import { createReviewSchema, draftSchema, getVideoPromptRequirements, inspectDraft } from "@/agent/videoPrompt/format";
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
  z.strictObject({ action: z.literal("submit"), preparationId: fields.preparationId, draft: fields.draft, review: fields.review }),
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
      expectedRevision: prepared.revision, reviewRequirements: getVideoPromptRequirements(prepared.shot),
      nextAction: "由当前外部 Agent 按 workflow、导演及 H3 技能编写中英文稿，调用 inspect 预检，再自行逐项审核并 submit；这些步骤不调用语言模型。" };
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
    const findings = inspectDraft(input.draft, current);
    if (input.action === "inspect") return { status: findings.length ? "rejected" : "ok", findings };
    if (findings.length) return { status: "rejected", findings };
    const review = createReviewSchema(getVideoPromptRequirements(current.shot).map(item => item.id)).parse(input.review);
    if (review.status !== "ok") return { status: "rejected", findings: review.findings };
    if (saved.approved) {
      if (!isDeepStrictEqual(saved.approved.draft, input.draft) || !isDeepStrictEqual(saved.approved.review, review)) {
        throw Object.assign(new Error("该准备记录已批准另一份稿件，请重新 prepare"), { status: 409 });
      }
      return { ...saved.approved.result, reviewer };
    }
    const generationRequest = videoGenerationSchema.parse({ ...current.generationRequest, prompt: input.draft.prompt });
    const reviewId = await saveVideoReview({ ...current.snapshot, prompt: input.draft.prompt }, {
      shot: current.shot, cinematicPlan: input.draft.cinematicPlan, promptZh: input.draft.promptZh,
      request: generationRequest, review, reviewer, preparationId: input.preparationId,
    });
    const result = { status: "ok", reviewId, reviewer, generationRequest: { ...generationRequest, reviewId },
      node: saved.input.node, expectedRevision: current.revision, written: false };
    saved.approved = { draft: input.draft, review, result };
    await writeAtomic(path, JSON.stringify(saved), { mode: 0o600 });
    return result;
  } finally { release(); }
}
