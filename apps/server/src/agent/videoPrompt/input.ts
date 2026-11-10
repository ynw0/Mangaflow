import { open, stat } from "@toonflow/file";
import { z } from "zod";
import type { CanvasContext, MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { templateConditions, templateTagSchema } from "@/agent/videoPrompt/templates/schema";
import { findWorkflow, imageReferenceRange, toMediaModel } from "@/utils/production/catalog";
import { isWorkflowEnabled, readProduction } from "@/utils/production/config";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { detectMimeType } from "@/utils/media/priceReference";
import { prepareComfyWorkflow } from "@/utils/production/run";
import { captureVideoReview } from "@/utils/production/videoReviews";

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
  outputFirstPass: z.boolean().optional(),
});

const ratioSchema = z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"]);
const shotFields = {
  shotId: shortText,
  story: description,
  purpose: shortText,
  style: description,
  continuityIn: z.string().trim().max(3000),
  continuityOut: z.string().trim().max(3000),
  mustHave: requirements.describe("必须出现的剧情事实，逐条填写字符串数组；无内容传 []，不能传字符串"),
  mustNotHave: requirements.describe("禁止出现的事实，逐条填写字符串数组；无内容传 []"),
  intent: z.enum(["dialogue", "action", "effects", "mechanical", "reveal", "environment"]),
  adjacentShots: z.string().trim().max(6000).optional(),
  regenerate: z.boolean().optional().describe("明确要求重新创作时传 true；省略则相同已审镜头直接复用审核结果"),
  templateTags: templateTagSchema.optional(),
  templateConditions: templateConditions.pick({ subjectCount: true, anchors: true }).optional(),
  references: z.array(reference).max(24),
};
const newShotFields = {
  ...shotFields,
  node: z.never().optional(),
  modelId: shortText.optional(),
  duration: z.number().int().positive(),
  sampling: sampling.optional(),
  ratio: ratioSchema,
};
// 已有节点只提供定位信息；新镜头的规格与种子政策由请求明确给出。
export const videoPromptParameters = z.union([
  z.strictObject({ ...shotFields,
    node: z.strictObject({ canvasId: shortText, nodeId: shortText, write: z.boolean().optional() }),
    modelId: z.never().optional(), duration: z.never().optional(), ratio: z.never().optional(),
    sampling: z.never().optional(), seed: z.never().optional(), seedMode: z.never().optional(),
  }).describe("已有视频节点：先 getConfig → setConfig → getPromptContext，再传 node；禁止重复传生成参数"),
  z.strictObject({ ...newShotFields, seedMode: z.literal("random").optional(), seed: z.never().optional() }),
  z.strictObject({ ...newShotFields, seedMode: z.enum(["fixed", "last"]), seed: videoGenerationSchema.shape.seed.unwrap() }),
]).describe("已有节点只传 node 与镜头合同；新镜头必须传 duration、ratio。新镜头随机模式不传 seed，fixed/last 模式必须同时传具体 seed。");

const nodeContext = z.object({
  config: z.object({
    providerId: z.string(), modelId: z.string(), duration: z.number().int().positive(),
    ratio: z.string(), mode: z.union([z.string(), z.array(z.string())]),
    generateAudio: z.boolean().optional(), resolution: z.string().optional(),
    megapixels: z.number().optional(), upscale: z.number().optional(),
    firstPassSteps: z.number().optional(), secondPassSteps: z.number().optional(),
    outputFirstPass: z.boolean().optional(),
    seed: z.number().optional(), seedMode: z.string().optional(),
    supportsSeed: z.boolean().optional(),
  }),
  revision: z.string(),
  request: videoGenerationSchema.extend({ prompt: z.string() }),
  images: z.array(material).optional(),
  videos: z.array(material).optional(),
  audios: z.array(material).optional(),
  firstFrame: material.optional(),
  lastFrame: material.optional(),
});

export type VideoPromptInput = z.infer<typeof videoPromptParameters>;
export type VideoPromptFormat = "h3Ref2va" | "h3Frames" | "h3Text";

export async function prepareVideoPrompt(cwd: string, input: VideoPromptInput, canvas?: CanvasContext, signal?: AbortSignal) {
  const { node, modelId, duration, ratio, references, sampling: requestedSampling, seed, seedMode, templateTags, templateConditions, regenerate: _regenerate, ...shot } = input;
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
  if (current && (seed !== undefined || seedMode !== undefined)) throw new Error("已有节点使用节点种子配置，请先在节点上确认种子");
  const workflow = await findWorkflow(current?.config.modelId ?? modelId ?? production.videoWorkflow);
  if (workflow.kind !== "video" || !workflow.bindings.promptFormat || !isWorkflowEnabled(workflow.id)) {
    throw new Error(`工作流 ${workflow.id} 未启用或没有 H3 提示词规则`);
  }
  const model = toMediaModel(workflow);
  const seconds = current?.config.duration ?? duration;
  const aspect = current?.config.ratio ?? ratio;
  if (!seconds || !aspect) throw new Error("新镜头需要明确时长和画幅");
  const capability = model.durationResolutionMap?.find(item => item.duration.includes(seconds));
  if (!capability || !ratioSchema.safeParse(aspect).success) throw new Error(`工作流 ${workflow.id} 不支持 duration=${seconds} 或 ratio=${aspect}。允许时长：${JSON.stringify(model.durationResolutionMap?.flatMap(item => item.duration))}；允许画幅：${ratioSchema.options.join("、")}`);
  if (current?.config.resolution && capability.resolution.length && !capability.resolution.includes(current.config.resolution)) {
    throw new Error("当前分辨率不适用于该时长");
  }
  const spec = model.sampling;
  if (requestedSampling && (!spec
    || (requestedSampling.megapixels !== undefined && !spec.megapixels.includes(requestedSampling.megapixels))
    || (requestedSampling.upscale !== undefined && (requestedSampling.upscale < spec.upscaleMin || requestedSampling.upscale > spec.upscaleMax))
    || (requestedSampling.firstPassSteps !== undefined && spec.firstPassDefault === undefined)
    || (requestedSampling.secondPassSteps !== undefined && spec.secondPassDefault === undefined)
    || (requestedSampling.outputFirstPass !== undefined && !model.supportsFirstPassOutput))) {
    throw new Error(`字段 sampling=${JSON.stringify(requestedSampling)} 不受工作流 ${workflow.id} 支持。实际采样能力：${JSON.stringify(spec ?? null)}。请重新核对模型能力。`);
  }
  const approved = await Promise.all(references.map(async item => {
    signal?.throwIfAborted();
    const target = await resolveWorkspacePath(cwd, item.path);
    if (!(await stat(target.path)).isFile()) throw new Error(`参考素材不是文件：${item.path}`);
    const handle = await open(target.path, "r");
    let mimeType: string;
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(16));
      mimeType = detectMimeType(buffer.subarray(0, bytesRead), "");
    } finally { await handle.close(); }
    if (!mimeType.startsWith(`${item.kind}/`)) throw new Error(`参考素材类型不符：${item.path}`);
    return { ...item, mimeType, path: item.path.replaceAll("\\", "/") };
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
  const mediaRefs = (items: typeof approved) => items.map(({ path, mimeType }) => ({ path, mimeType }));
  const generationRequest: MediaGenerationRequest = current ? { ...current.request, prompt: "", reviewId: undefined } : {
    providerId: "comfyui", modelId: workflow.id, prompt: "", duration: seconds, ratio: aspect,
    resolution: spec ? undefined : capability.resolution[0],
    mode: (format === "h3Frames" ? "startEndRequired" : approved.length
      ? model.mode.find(Array.isArray) : "text") as MediaGenerationRequest["mode"],
    generateAudio: model.audio === true || model.audio === "optional",
    ...requestedSampling, seed, seedMode,
    ...(format === "h3Frames" ? { firstFrame: mediaRefs(images)[0], lastFrame: mediaRefs(images)[1] }
      : { images: mediaRefs(images), videos: mediaRefs(videos), audios: mediaRefs(audios) }),
  };
  const effective = await prepareComfyWorkflow({ directory: cwd, mediaType: "video", request: generationRequest, signal });
  const snapshot = await captureVideoReview(cwd, effective, signal);
  const numbered = (items: typeof approved, name: string) => items.map((item, index) => ({ ...item, label: `<${name} ${index + 1}>` }));
  return {
    shot, format, revision: current?.revision, templateTags, templateConditions, generationRequest, snapshot,
    setup: {
      modelId: workflow.id, duration: seconds, ratio: aspect, mode: current?.config.mode ?? format,
      host: production.videoHost, config: current?.config, usage: workflow.bindings.usage,
      parameters: snapshot.parameters, seedMode: effective.seedMode,
      samplingCapabilities: spec, requestedSampling,
      references: [...numbered(images, "Picture"), ...numbered(videos, "Video"), ...numbered(audios, "Audio")],
    },
  };
}
