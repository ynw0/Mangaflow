import { open, stat } from "@toonflow/file";
import { z } from "zod";
import { h3OptionsSchema, videoQcContractSchema, type CanvasContext, type MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { checkCreativeSelection, creativeTones } from "@/agent/creativeKnowledge";
import { requiresContinuousTake } from "@/agent/videoPrompt/format";
import { compileVoiceCast, type VoiceCastRole } from "@/agent/creativeKnowledge/voiceTemplates";
import { templateConditions, templateTagSchema } from "@/agent/videoPrompt/templates/schema";
import { findWorkflow, imageReferenceRange, toMediaModel } from "@/utils/production/catalog";
import { isWorkflowEnabled, readProduction } from "@/utils/production/config";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { detectMimeType } from "@/utils/media/priceReference";
import { prepareComfyWorkflow } from "@/utils/production/run";
import { captureVideoReview } from "@/utils/production/videoReviews";
import { maxVideoDialogueLines } from "@/utils/production/videoPlan";

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
  loraName: z.string().max(512).optional(),
  h3Options: h3OptionsSchema.optional(),
  checkpointName: z.string().trim().min(1).max(512).regex(/^[^\x00-\x1f]+$/).optional(),
});

const ratioSchema = z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"]);
const shotFields = {
  shotId: shortText.describe("顶层填写已确认镜头合同的真实编号。画布节点编号填 node.nodeId"),
  story: description.describe("已确认的镜头剧情。有对白时交代每句由谁说，齐声时列明共同发声的人"),
  lockedDialogue: z.array(description).max(maxVideoDialogueLines).optional().describe("从最新确认的正式剧本取本镜需要模型发声的原话，含旁白和独白，按实际开口顺序填写。直接复用的录音按素材用途记录。与旧分镜不一致时，先更新相关的上游剧本或分镜。无须生成台词时传 []"),
  purpose: shortText,
  style: description,
  continuityIn: z.string().trim().max(3000).describe("本镜开始时需要延续上一镜结束时的状态，可包含画外人物或物件"),
  continuityOut: z.string().trim().max(3000).describe("下一镜要承接的结束状态，可包含画外人物或物件。合同明确要求在镜头结束时看到或听到的事实，另填入 mustHave"),
  mustHave: requirements.describe("本镜必须让观众看到或听到的事实，如果需要在镜头结束时呈现，请写明具体时间。逐条填数组，无内容传 []"),
  mustNotHave: requirements.describe("禁止出现的事实，逐条填写字符串数组；无内容传 []"),
  intent: z.enum(["dialogue", "action", "effects", "mechanical", "reveal", "environment"]),
  tone: z.enum(creativeTones).optional().describe("镜头合同中已确认的基调，用于核对所选创作模板"),
  adjacentShots: z.string().trim().max(6000).optional().describe("本镜回应先前台词或事件时，摘录已确认的相关场次或镜号、说话人和原句或动作，可引用更早的铺垫。仅供核对承接"),
  regenerate: z.boolean().optional().describe("仅当用户明确要求重新创作整份提示词时传 true。局部修改直接在画布现稿上修改，调整生成参数时保留正文"),
  reReview: z.boolean().optional().describe("显式独立复审画布现稿或历史稿件，与 regenerate 互斥"),
  independentReview: z.boolean().optional().describe("明确需要独立审核时启用；默认关闭，有现稿时直接核对现稿"),
  templateTags: templateTagSchema.optional().describe("有具体拍摄问题时填一个维度和一个标签，用于检索拍法"),
  templateConditions: templateConditions.pick({ subjectCount: true, anchors: true }).optional(),
  references: z.array(reference).max(24).describe("按实际槽位顺序传 JSON 对象数组，不是字符串"),
  voiceCast: z.array(z.strictObject({
    speakerId: z.string().regex(/^S[1-9]\d*$/).describe("每次独立生成视频时，按定稿中实际说话人首次发声的顺序从 S1 连续编号，不使用整部剧的角色编号。同一人在本视频内再次开口（包括切换镜头后）沿用原编号；首次发声时多人齐声说话，按合同列出的姓名顺序编号。未发声的人不分配 S 编号"),
    characterName: shortText,
    voiceIdentity: z.string().trim().min(1).max(800).optional().describe("填写已确认、需要在不同镜头中保持一致的音色、音区、共鸣或发音特点。本镜的停顿、重音和情绪根据当前场戏另行描述，保留原话、数字和单位"),
    sourceId: shortText.optional().describe("画内对白用 vs01，仅观众听到的旁白用 vs02，内心独白用 vs03，无实体网文系统用 vs04 至 vs07。现场说话人暂时处于画面之外，或交替进入画面时，可省略此项，逐句写实际声源与听觉范围"),
    timbreId: shortText.optional(), ageId: shortText.optional(), personalityId: shortText.optional(),
    foreignAccentId: shortText.optional(), dialectId: shortText.optional(), emotionId: shortText.optional(),
    deliveryId: shortText.optional(), paceId: shortText.optional(),
    speedMultiplier: z.number().min(0.7).max(1.8).optional().describe("仅有明确语速倍数要求时填写，与 paceId 二选一；未指定不补默认值"),
  })).max(8).optional().describe("H3 视频同期配音：只填写本次视频实际发声的角色，不填写仅出现在画面中的人物。编号从 S1 开始连续且不重复，声音模板与语速均按需指定，未指定语速不自动补入"),
};
const creativeSelection = z.strictObject({
  narrativeId: shortText.optional(),
  memeId: shortText.optional(),
  absurdId: shortText.optional(),
  expressionId: shortText.optional(),
  styleId: shortText.optional(),
  filterId: shortText.optional(),
}).describe("可选：先调用 searchVideoPromptTemplates 检索，再传选择的模板 ID；不要复制整条模板正文");

// 顶层必须是一个纯 object JSON Schema：宿主无法可靠地把 z.union 的 anyOf 分支还原为类型化工具参数。
// 分支约束在服务器解析后执行，不向 Agent 暴露互斥的根 anyOf；数组/数字/对象保持原生 JSON 类型。
const videoPromptToolInput = z.strictObject({
  ...shotFields,
  creativeSelection: creativeSelection.optional(),
  node: z.strictObject({ canvasId: shortText, nodeId: shortText, write: z.boolean().optional() }).optional()
    .describe("已有节点：canvasId 仅放在 node 对象中；顶层仍须传 shotId、合同与 references；先 getConfig → setConfig → getPromptContext"),
  modelId: shortText.optional().describe("仅新镜头可传；已有节点禁止传"),
  duration: z.number().int().positive().optional().describe("新镜头必填秒数；已有节点禁止传"),
  ratio: ratioSchema.optional().describe("新镜头必填画幅；已有节点禁止传"),
  sampling: sampling.optional().describe("仅新镜头可用；已有节点从 node:getPromptContext 读取"),
  seedMode: z.enum(["random", "fixed", "last"]).optional().describe("仅新镜头；fixed/last 模式必须同时提供有效的 seed"),
  seed: videoGenerationSchema.shape.seed.unwrap().optional().describe("仅新镜头 fixed/last 模式填写数值种子"),
}).describe("单一类型化对象：必填镜头合同。已有视频节点只传 node，不传模型、时长、画幅、采样或种子；新镜头不传 node，必须传 duration 与 ratio。mustHave/mustNotHave/references 是 JSON 数组，不是字符串。");

// JSON Schema 用于宿主工具调用（无顶层 anyOf/oneOf）；业务分支在 Zod 运行时进行严格校验。
const newShotInput = videoPromptToolInput.required({ lockedDialogue: true });
export const videoPromptToolSchema = z.toJSONSchema(newShotInput, { io: "input", target: "draft-07" });
function validateShotInput(input: z.infer<typeof videoPromptToolInput>, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (input.regenerate && input.reReview) issue("reReview", "复审现稿与从头重写只能选择一种");
  const speakers = input.voiceCast ?? [];
  const ids = new Set(speakers.map(role => role.speakerId));
  if (ids.size !== speakers.length || speakers.some((_, index) => !ids.has(`S${index + 1}`))) {
    const supplied = speakers.map(role => `${role.characterName}(${role.speakerId})`).join("、");
    const expected = speakers.map((_, index) => `S${index + 1}`).join("、");
    issue("voiceCast", `当前视频的说话人编号为 ${supplied}，必须使用 ${expected}，不得跳号或重复。请按定稿中的首次发声顺序重新分配编号，同步修正 story 中的说话人标记，保留原话、角色身份和声线；不要按数组顺序直接替换编号。`);
  }
  if (input.node) {
    for (const name of ["modelId", "duration", "ratio", "sampling", "seed", "seedMode"] as const) {
      if (input[name] !== undefined) issue(name, "已有节点不允许重复传生成参数，请先在画布节点 setConfig 后读取 getPromptContext");
    }
  } else {
    if (input.duration === undefined) issue("duration", "新镜头必须提供数字时长（秒）");
    if (input.ratio === undefined) issue("ratio", "新镜头必须提供明确画幅");
    if (input.seedMode === "fixed" || input.seedMode === "last") {
      if (input.seed === undefined) issue("seed", "fixed/last 模式必须提供数值 seed");
    } else if (input.seed !== undefined) {
      issue("seed", "随机种子模式不能传 seed；需要固定种子时设置 seedMode=fixed");
    }
  }
}
export const videoPromptParameters = newShotInput.superRefine(validateShotInput);
// 已保存的待审稿可能早于锁词字段，回读时保留原合同。
export const savedVideoPromptParameters = videoPromptToolInput.superRefine(validateShotInput);

const nodeContext = z.object({
  config: z.object({
    providerId: z.string(), modelId: z.string(), duration: z.number().int().positive(),
    ratio: z.string(), mode: z.union([z.string(), z.array(z.string())]),
    generateAudio: z.boolean().optional(), resolution: z.string().optional(),
    megapixels: z.number().optional(), upscale: z.number().optional(),
    firstPassSteps: z.number().optional(), secondPassSteps: z.number().optional(),
    outputFirstPass: z.boolean().optional(),
    loraName: z.string().max(512).optional(),
    h3Options: h3OptionsSchema.optional(),
    checkpointName: z.string().max(512).optional(),
    seed: z.number().optional(), seedMode: z.string().optional(),
    supportsSeed: z.boolean().optional(),
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

export type VideoPromptInput = z.infer<typeof savedVideoPromptParameters>;
export type VideoPromptFormat = "h3Ref2va" | "h3Frames" | "h3Text";

export async function prepareVideoPrompt(cwd: string, input: VideoPromptInput, canvas?: CanvasContext, signal?: AbortSignal) {
  const { node, modelId, duration, ratio, references, sampling: requestedSampling, seed, seedMode, templateTags, templateConditions, creativeSelection: selectedCreative, regenerate: _regenerate, reReview: _reReview, independentReview: _independentReview, ...shot } = input;
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
  if (model.type !== "video") throw new Error(`工作流 ${workflow.id} 不是视频工作流`);
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
    || (requestedSampling.outputFirstPass !== undefined && !model.supportsFirstPassOutput)
    || (requestedSampling.h3Options !== undefined && !model.h3Advanced)
    || (requestedSampling.loraName !== undefined && !model.lora)
    || (requestedSampling.checkpointName !== undefined && !model.checkpoint))) {
    throw new Error(`字段 sampling=${JSON.stringify(requestedSampling)} 不受工作流 ${workflow.id} 支持。实际采样能力：${JSON.stringify(spec ?? null)}。请重新核对模型能力。`);
  }
  // 内置导演和外部 MCP 均按同一镜头合同检查模板，再读取参考素材。
  const selection = selectedCreative && checkCreativeSelection({
    selected: selectedCreative, medium: "video", tone: shot.tone, durationSeconds: seconds,
    singleShot: requiresContinuousTake(shot), forDraft: true,
  });
  if (selection?.status === "invalid") throw new Error(`创作模板无法用于当前视频片段：${selection.errors.join("；")}`);
  const creativeContext = selection && { selected: selection.selected, warnings: selection.warnings, guidance: selection.guidance };
  const voiceContext = compileVoiceCast((input.voiceCast ?? []) as VoiceCastRole[]);
  if (voiceContext.status === "invalid") throw new Error(`角色声音模板配置冲突：${voiceContext.errors.join("；")}`);
  const audioEnabled = model.audio === "optional" && current?.request.generateAudio !== false;
  if (voiceContext.roles.length && !audioEnabled) throw new Error("角色声音模板需要开启支持同期音轨的 H3 工作流");
  if (shot.lockedDialogue?.length && !audioEnabled) throw new Error("本镜有锁定的同期台词，请确认音轨设置或调整制作合同后重新提交，保留原话");
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
  const generationRequest: MediaGenerationRequest = current ? { ...current.request, prompt: "", reviewId: undefined, qcContract: videoQcContractSchema.parse(shot) } : {
    providerId: "comfyui", modelId: workflow.id, prompt: "", duration: seconds, ratio: aspect, qcContract: videoQcContractSchema.parse(shot),
    resolution: spec ? undefined : capability.resolution[0],
    mode: (format === "h3Frames" ? "startEndRequired" : approved.length
      ? model.mode.find(Array.isArray) : "text") as MediaGenerationRequest["mode"],
    generateAudio: audioEnabled,
    ...requestedSampling, seed, seedMode,
    ...(format === "h3Frames" ? { firstFrame: mediaRefs(images)[0], lastFrame: mediaRefs(images)[1] }
      : { images: mediaRefs(images), videos: mediaRefs(videos), audios: mediaRefs(audios) }),
  };
  const effective = await prepareComfyWorkflow({ directory: cwd, mediaType: "video", request: generationRequest, signal });
  const snapshot = await captureVideoReview(cwd, effective, signal);
  const numbered = (items: typeof approved, name: string) => items.map((item, index) => ({ ...item, label: `<${name} ${index + 1}>` }));
  return {
    shot, format, revision: current?.revision,
    nodeDraft: current && { reviewId: current.request.reviewId, prompt: current.request.prompt, promptZh: current.promptZh },
    templateTags, templateConditions, creativeContext, voiceContext, audioEnabled, generationRequest, snapshot,
    setup: {
      modelId: workflow.id, duration: seconds, ratio: aspect, mode: current?.config.mode ?? format,
      host: production.videoHost, config: current?.config, usage: workflow.bindings.usage,
      parameters: snapshot.parameters, seedMode: effective.seedMode,
      samplingCapabilities: spec, requestedSampling,
      references: [...numbered(images, "Picture"), ...numbered(videos, "Video"), ...numbered(audios, "Audio")],
    },
  };
}
