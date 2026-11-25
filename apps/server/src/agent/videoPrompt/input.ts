import { z } from "zod";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import type { PromptInspectionContext, VideoPromptFormat } from "@/agent/videoPrompt/format";
import { findWorkflow } from "@/utils/production/catalog";
import { isWorkflowEnabled } from "@/utils/production/config";
import { maxVideoDialogueLines } from "@/agent/videoPrompt/dialogue";

const shortText = z.string().trim().min(1).max(500);
const description = z.string().trim().min(1).max(6000);
const requirements = z.array(shortText).max(32);
const material = z.object({ path: z.string().min(1).max(2048) });

const voiceCastRole = z.strictObject({
  speakerId: z.string().regex(/^S[1-9]\d*$/),
  characterName: shortText,
  sourceId: shortText.optional(),
});

// 只读检查：目标节点必填。未写入 qcContract 的节点可另传已确认合同，不补造。
const inspectCanvasPromptObject = z.strictObject({
  node: z.strictObject({ canvasId: shortText, nodeId: shortText }),
  story: description.optional(),
  mustHave: requirements.optional(),
  mustNotHave: requirements.optional(),
  continuityIn: z.string().trim().max(3000).optional(),
  continuityOut: z.string().trim().max(3000).optional(),
  lockedDialogue: z.array(description).max(maxVideoDialogueLines).optional(),
  voiceCast: z.array(voiceCastRole).max(8).optional(),
});
export const inspectCanvasPromptParameters = inspectCanvasPromptObject.refine(value => {
  const roles = value.voiceCast;
  if (!roles?.length) return true;
  const ids = roles.map(role => role.speakerId);
  if (new Set(ids).size !== ids.length) return false;
  return [...ids].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)))
    .every((id, index) => id === `S${index + 1}`);
}, { path: ["voiceCast"], message: "说话人须按本片首次发声顺序使用连续编号 S1、S2、S3…，不得沿用整部剧编号或跳号" });
export const inspectCanvasPromptToolSchema = z.toJSONSchema(inspectCanvasPromptObject, { io: "input", target: "draft-07" });

const nodeContext = z.object({
  config: z.object({
    providerId: z.string(), modelId: z.string(), duration: z.number().int().positive(),
    ratio: z.string(), mode: z.union([z.string(), z.array(z.string())]),
    generateAudio: z.boolean().optional(),
  }),
  revision: z.string(),
  promptZh: z.string().optional(),
  request: videoGenerationSchema.extend({ prompt: z.string() }),
  images: z.array(material).optional(),
  videos: z.array(material).optional(),
  audios: z.array(material).optional(),
  firstFrame: material.optional(),
  lastFrame: material.optional(),
});

/** 现稿检查只使用当前画布数据和工作流元数据，不读取媒体文件或运行模型。 */
export async function readCanvasPromptForInspection(
  input: z.infer<typeof inspectCanvasPromptParameters>,
  canvas?: CanvasContext,
  signal?: AbortSignal,
): Promise<PromptInspectionContext> {
  if (!canvas) throw new Error("请先打开目标视频节点所在的画布");
  const current = nodeContext.parse(await canvas.call({
    name: "nodeTools", args: { canvasId: input.node.canvasId, nodeId: input.node.nodeId, name: "node:getPromptContext", args: {} },
  }, signal));
  if (current.config.providerId !== "comfyui") throw new Error("当前模型没有 H3 提示词规则");
  const workflow = await findWorkflow(current.config.modelId);
  if (workflow.kind !== "video" || !workflow.bindings.promptFormat || !isWorkflowEnabled(workflow.id)) {
    throw new Error("当前工作流未启用或没有 H3 提示词规则");
  }
  const images = workflow.bindings.promptFormat === "h3Frames" ? [current.firstFrame, current.lastFrame].filter(Boolean) : current.images ?? [];
  const videos = current.videos ?? [];
  const audios = current.audios ?? [];
  const format: VideoPromptFormat = workflow.bindings.promptFormat === "h3Frames" ? "h3Frames" : images.length || videos.length || audios.length ? "h3Ref2va" : "h3Text";
  const labels = (count: number, kind: string) => Array.from({ length: count }, (_, i) => ({ label: `<${kind} ${i + 1}>` }));
  const saved = current.request.qcContract;
  const hasContract = Boolean(saved) || Boolean(input.story && input.mustHave && input.mustNotHave);
  return {
    format,
    setup: { duration: current.config.duration, references: [...labels(images.length, "Picture"), ...labels(videos.length, "Video"), ...labels(audios.length, "Audio")] },
    shot: {
      story: saved?.story ?? input.story ?? "",
      mustHave: saved?.mustHave ?? input.mustHave ?? [],
      mustNotHave: saved?.mustNotHave ?? input.mustNotHave ?? [],
      lockedDialogue: saved?.lockedDialogue ?? input.lockedDialogue,
      voiceCast: input.voiceCast,
    },
    audioEnabled: current.request.generateAudio !== false && workflow.hasVideoAudio === true,
    contextWarnings: hasContract ? [] : ["节点没有保存完整的已确认镜头合同；本次只检查现稿格式、参考及已知约束，不代表剧情全部核验通过。"],
    nodeDraft: { prompt: current.request.prompt, promptZh: current.promptZh },
    revision: current.revision,
  };
}
