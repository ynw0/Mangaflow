import { stat } from "@toonflow/file";
import { z } from "zod";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { findWorkflow, imageReferenceRange, toMediaModel } from "@/utils/production/catalog";
import { isWorkflowEnabled, readProduction } from "@/utils/production/config";
import { resolveWorkspacePath } from "@/utils/workspace/files";

const shortText = z.string().trim().min(1).max(500);
const description = z.string().trim().min(1).max(6000);
const requirements = z.array(shortText).max(32);
const material = z.object({ path: z.string().min(1).max(2048) });
const reference = material.extend({
  kind: z.enum(["image", "video", "audio"]),
  purpose: shortText,
  description: description,
});
const sampling = z.strictObject({
  megapixels: z.number().positive().optional(),
  upscale: z.number().min(1).max(4).optional(),
  firstPassSteps: z.number().int().min(1).max(64).optional(),
  secondPassSteps: z.number().int().min(1).max(64).optional(),
});

export const videoPromptParameters = z.strictObject({
  shotId: shortText,
  story: description,
  purpose: shortText,
  style: description,
  continuityIn: z.string().trim().max(3000),
  continuityOut: z.string().trim().max(3000),
  mustHave: requirements,
  mustNotHave: requirements,
  intent: z.enum(["dialogue", "action", "effects", "mechanical", "reveal", "environment"]),
  adjacentShots: z.string().trim().max(6000).optional(),
  references: z.array(reference).max(24),
  node: z.strictObject({ canvasId: shortText, nodeId: shortText, write: z.boolean().optional() }).optional(),
  modelId: shortText.optional(),
  duration: z.number().int().positive().optional(),
  sampling: sampling.optional(),
  ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"]).optional(),
});

const nodeContext = z.object({
  config: z.object({
    providerId: z.string(), modelId: z.string(), duration: z.number().int().positive(),
    ratio: z.string(), mode: z.union([z.string(), z.array(z.string())]),
    generateAudio: z.boolean().optional(), resolution: z.string().optional(),
    megapixels: z.number().optional(), upscale: z.number().optional(),
    firstPassSteps: z.number().optional(), secondPassSteps: z.number().optional(),
    seed: z.number().optional(), seedMode: z.string().optional(),
  }),
  revision: z.string(),
  images: z.array(material).optional(),
  videos: z.array(material).optional(),
  audios: z.array(material).optional(),
  firstFrame: material.optional(),
  lastFrame: material.optional(),
});

export type VideoPromptInput = z.infer<typeof videoPromptParameters>;
export type VideoPromptFormat = "h3Ref2va" | "h3Frames" | "h3Text";

export async function prepareVideoPrompt(cwd: string, input: VideoPromptInput, canvas?: CanvasContext, signal?: AbortSignal) {
  const { node, modelId, duration, ratio, references, sampling: requestedSampling, ...shot } = input;
  const production = readProduction();
  if (node && !canvas) throw new Error("请先打开目标视频节点所在的画布");
  const current = node && canvas ? nodeContext.parse(await canvas.call({
    name: "nodeTools", args: { canvasId: node.canvasId, nodeId: node.nodeId, name: "node:getPromptContext", args: {} },
  }, signal)) : undefined;
  if ((current && current.config.providerId !== "comfyui") || (!current && !modelId && production.videoProviderId !== "comfyui")) {
    throw new Error("当前模型没有 H3 提示词规则，请选择支持 H3 的工作流");
  }
  if (current && ((modelId !== undefined && modelId !== current.config.modelId)
    || (duration !== undefined && duration !== current.config.duration) || (ratio !== undefined && ratio !== current.config.ratio))) {
    throw new Error("镜头要求与当前节点配置不一致，请先核对工作流、时长与画幅");
  }
  if (current && requestedSampling) throw new Error("已有节点使用节点采样配置，请先在节点上确认参数");
  const workflow = await findWorkflow(current?.config.modelId ?? modelId ?? production.videoWorkflow);
  if (workflow.kind !== "video" || !workflow.bindings.promptFormat || !isWorkflowEnabled(workflow.id)) {
    throw new Error(`工作流 ${workflow.id} 未启用或没有 H3 提示词规则`);
  }
  const model = toMediaModel(workflow);
  const seconds = current?.config.duration ?? duration;
  const aspect = current?.config.ratio ?? ratio;
  if (!seconds || !aspect) throw new Error("新镜头需要明确时长和画幅");
  const capability = model.durationResolutionMap?.find(item => item.duration.includes(seconds));
  if (!capability || !videoPromptParameters.shape.ratio.safeParse(aspect).success) throw new Error("工作流不支持该时长或画幅");
  if (current?.config.resolution && capability.resolution.length && !capability.resolution.includes(current.config.resolution)) {
    throw new Error("当前分辨率不适用于该时长");
  }
  const spec = model.sampling;
  if (requestedSampling && (!spec
    || (requestedSampling.megapixels !== undefined && !spec.megapixels.includes(requestedSampling.megapixels))
    || (requestedSampling.upscale !== undefined && (requestedSampling.upscale < spec.upscaleMin || requestedSampling.upscale > spec.upscaleMax))
    || (requestedSampling.firstPassSteps !== undefined && spec.firstPassDefault === undefined)
    || (requestedSampling.secondPassSteps !== undefined && spec.secondPassDefault === undefined))) {
    throw new Error("请求的采样参数不受所选工作流支持");
  }
  const approved = await Promise.all(references.map(async item => {
    signal?.throwIfAborted();
    const target = await resolveWorkspacePath(cwd, item.path);
    if (!(await stat(target.path)).isFile()) throw new Error(`参考素材不是文件：${item.path}`);
    return { ...item, path: item.path.replaceAll("\\", "/") };
  }));
  const images = approved.filter(item => item.kind === "image");
  const videos = approved.filter(item => item.kind === "video");
  const audios = approved.filter(item => item.kind === "audio");
  const format: VideoPromptFormat = workflow.bindings.promptFormat === "h3Frames" ? "h3Frames" : approved.length ? "h3Ref2va" : "h3Text";
  const { min, max } = imageReferenceRange(workflow);
  if (format === "h3Frames" ? images.length !== 2 || videos.length > 0 || audios.length > 0
    : images.length < min || images.length > max || videos.length > (model.references?.video ?? 0) || audios.length > (model.references?.audio ?? 0)) {
    throw new Error("批准参考的数量或类型与所选工作流的实际绑定不匹配");
  }
  if (current) {
    const imageInputs = format === "h3Frames" ? [current.firstFrame, current.lastFrame] : current.images ?? [];
    for (const [connected, selected] of [[imageInputs, images], [current.videos ?? [], videos], [current.audios ?? [], audios]] as const) {
      if (connected.length !== selected.length || connected.some((item, index) => item?.path.replaceAll("\\", "/") !== selected[index]?.path)) {
        throw new Error("批准参考与视频节点实际输入的文件或顺序不一致");
      }
    }
  }
  const numbered = (items: typeof approved, name: string) => items.map((item, index) => ({ ...item, label: `<${name} ${index + 1}>` }));
  return {
    shot, format, revision: current?.revision,
    setup: {
      modelId: workflow.id, duration: seconds, ratio: aspect, mode: current?.config.mode ?? format,
      host: production.videoHost, config: current?.config, usage: workflow.bindings.usage,
      samplingCapabilities: spec, requestedSampling,
      references: [...numbered(images, "Picture"), ...numbered(videos, "Video"), ...numbered(audios, "Audio")],
    },
  };
}
