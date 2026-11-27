import { z } from "zod";
import type { ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import { agentVideoQcSubmissionSchema, audioGenerationSchema, imageGenerationSchema, listMediaModelsSchema, qcRectificationPlanSchema, qcVideoSchema, videoGenerationSchema, videoQcStatusSchema } from "./runtime";

const configSchema = z.strictObject({
  allowImage: z.boolean().default(true),
  allowVideo: z.boolean().default(true),
  allowAudio: z.boolean().default(true),
});

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools({ media, config }) {
    if (!media) return [];
    const permissions = configSchema.parse(config);
    const generationTools = ([
      { name: "generateImage", mediaType: "image", enabled: permissions.allowImage, label: "生成图片", parameters: imageGenerationSchema, description: "根据提示词和可选的工作区参考图生成图片。" },
      { name: "generateVideo", mediaType: "video", enabled: permissions.allowVideo, label: "生成视频", parameters: videoGenerationSchema, description: "根据提示词和可选的工作区图片、视频、音频、首尾帧生成视频。使用 H3 时按实际模式提供提示词及真实参考，优先使用画布视频节点。可传已确认的 qcContract 供成片质检。如果模型权重、LoRA、采样参数、种子、分辨率或生成主机发生变化，需要根据当前工作流的能力和已获得的算力使用授权进行校验。只有兼容的 H3 双阶段采样工作流支持 h3Options。必须使用当前主机实际返回的可用选项，不得擅自增加或替换 LoRA。使用固定种子或固定上一次随机生成的种子时，必须传入具体的 seed；随机模式传入 seedMode=random。按模型能力设置生成模式、时长、分辨率和音频。用户没指定采样时不要传 megapixels、upscale、firstPassSteps、secondPassSteps，双阶段采样工作流默认使用 0.2 百万像素、2 倍放大，第一阶段采样 8 步，第二阶段采样 4 步。单次采样工作流使用 steps、sampler、scheduler 和 scaleOutput；没有放大倍率时不要传 upscale，没有 h3Advanced 时不要传 h3Options。全能参考 1080P 默认百万像素 0.5、8 步，并输出 1080P。" },
      { name: "generateAudio", mediaType: "audio", enabled: permissions.allowAudio, label: "生成音频", parameters: audioGenerationSchema, description: "根据文本或提示词和可选的工作区参考图片和音频生成音频。按模型能力设置音色、语速、音量、语种、采样率和格式。" },
    ] as const).filter(operation => operation.enabled);
    const listTool: ToolDefinition = {
      name: "listMediaModels",
      label: "查询媒体模型",
      description: "查询已允许生成的媒体模型，返回 providerId、modelId、类型、模式及支持的画幅、时长、分辨率或音色。生成前先查询，不能猜测模型 ID。",
      parameters: z.toJSONSchema(listMediaModelsSchema, { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        listMediaModelsSchema.parse(params);
        signal?.throwIfAborted();
        const result = (await media.listModels()).filter(model => generationTools.some(operation => operation.mediaType === model.type));
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    };
    const qcTool: ToolDefinition = {
      name: "qcVideo",
      label: "成片质检",
      description: "按设置发起成片验收。主 Agent 抽帧模式会返回 awaitingAgent，随后必须调用 getVideoQcFrames 查看实际画面，再用 submitVideoQc 逐项提交验收结论。专用 QC 模式返回质检模型的结论；组合模式还需要主 Agent 查看抽取的画面。checklist 用于补充验收要求，不能代替已经审核的合同。",
      promptSnippet: "成片验收遵守设置里的方式、范围和触发条件；awaitingAgent 表示尚未验收完成。",
      parameters: z.toJSONSchema(qcVideoSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const result = await media.qcVideo(qcVideoSchema.parse(params), signal);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    };
    const qcStatusTool: ToolDefinition = {
      name: "getVideoQcStatus",
      label: "查询成片质检状态",
      description: "根据成片路径读取已经保存的质检记录。notes 是质检模型写下的观看原文，包括画面、声音、观感，以及和剧本、提示词、台词的差别。主 Agent 阅读 notes 后再分析。此工具本身不会启动生成。",
      parameters: z.toJSONSchema(videoQcStatusSchema, { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const { videoPath } = videoQcStatusSchema.parse(params);
        const result = await media.getVideoQcStatus(videoPath);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    };
    const framesTool: ToolDefinition = {
      name: "getVideoQcFrames", label: "主 Agent 读取质检画面",
      description: "读取处于 awaitingAgent 状态的成片的实际画面、时间戳、证据版本及必须检查的验收项。必须查看实际画面后才能提交结论；仅凭静态画面无法确认的动作或声音，应标为未验证。此操作不启动模型或生成视频。",
      parameters: z.toJSONSchema(videoQcStatusSchema, { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const { videoPath } = videoQcStatusSchema.parse(params);
        const { evidence, images } = await media.getAgentVideoQcEvidence(videoPath);
        return { details: evidence, content: [{ type: "text" as const, text: JSON.stringify({ ...evidence, nextAction: "查看实际图片后，根据 requirementId 使用 submitVideoQc 逐项提交结论；不能仅凭文件路径声称已经看过画面。" }) },
          ...images.flatMap((image, index) => [{ type: "text" as const, text: `第 ${index + 1} 帧，${evidence.frames[index]!.time.toFixed(3)} 秒` }, { type: "image" as const, ...image }])] };
      },
    };
    const submitTool: ToolDefinition = {
      name: "submitVideoQc", label: "提交主 Agent 质检结论",
      description: "看过 getVideoQcFrames 返回的实际图片后，携带相同 revision 提交逐项画面结论。不得用整体通过的结论代替逐项验收；遗漏的验收项或证据不足的项目仍为未验证。没有实际听过音轨时，不得声称音频通过验收。",
      parameters: z.toJSONSchema(agentVideoQcSubmissionSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const result = await media.submitAgentVideoQc(agentVideoQcSubmissionSchema.parse(params));
        return { details: result, content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    };
    const planTool: ToolDefinition = {
      name: "saveVideoQcRectificationPlan",
      label: "主 Agent 保存成片整改方案",
      description: "读取 getVideoQcStatus 的 issues 与 qcRevision 后，针对每项未通过或尚未验证的问题，提出可能的根本原因，说明需要调整的素材、提示词、工作流、采样参数或镜头，以及能够实际核验的验收标准。必须覆盖所有 issueIds。优先改变导致相同失败的参考或控制手段，不得只反复堆叠提示词。未确认的根因必须标记为假设。此工具只保存整改计划，不会授予重新生成的权限，也不会启动新的生成任务。",
      promptSnippet: "质检未通过时，先整理具体问题并提交结构化整改方案。如果同类问题反复出现，应调整解决策略，而不是反复改写提示词。保存方案不代表已经获得重新生成的授权。",
      parameters: z.toJSONSchema(qcRectificationPlanSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const result = await media.saveVideoQcRectificationPlan(qcRectificationPlanSchema.parse(params));
        return { details: result, content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    };
    const archiveInput = z.strictObject({ path: z.string().min(1), target: z.string().min(1) });
    const archiveTool: ToolDefinition = {
      name: "archiveAcceptedVideo", label: "归档成片",
      description: "将通过质检的视频和质检记录归档。传入工作区相对路径和目标文件名，目标目录须已存在。",
      parameters: z.toJSONSchema(archiveInput),
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const { path, target } = archiveInput.parse(params);
        const saved = await media.archiveAcceptedVideo(path, target);
        return { content: [{ type: "text", text: saved }], details: { path: saved } };
      },
    };
    return [archiveTool, qcTool, qcStatusTool, framesTool, submitTool, planTool, ...(generationTools.length ? [listTool] : []), ...generationTools.map<ToolDefinition>(operation => ({
      name: operation.name,
      label: operation.label,
      description: `${operation.description}providerId 和 modelId 必须来自 listMediaModels。引用素材的 path 及 outputDirectory 均为工作区相对路径；省略输出目录使用默认媒体目录。等待生成完成后返回已保存的文件路径，不返回 Base64。`,
      promptSnippet: "生成媒体前先查询 listMediaModels。",
      parameters: z.toJSONSchema(operation.parameters, { io: "input", target: "draft-07" }),
      executionMode: "sequential" as const,
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const parsed = operation.parameters.parse(params);
        // Agent 委派的 ComfyUI 视频也必须有固定 ID，失败后不能无意重复提交。
        const request = operation.mediaType === "video" && parsed.providerId === "comfyui"
          ? { ...parsed, generationId: ("generationId" in parsed && typeof parsed.generationId === "string")
            ? parsed.generationId : crypto.randomUUID() }
          : parsed;
        const jobId = "generationId" in request && typeof request.generationId === "string" ? request.generationId : undefined;
        let result: Awaited<ReturnType<typeof media.generateVideo>>;
        try {
          result = await media[operation.name](request, signal);
        } catch (error) {
          if (jobId) throw new Error(`${error instanceof Error ? error.message : String(error)}。原任务 generationId=${jobId}；若需恢复，必须沿用同一 ID 和完全相同的参数，不得直接新建请求。`);
          throw error;
        }
        const text = result.map(asset => {
          const url = asset.path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
          const preview = asset.mediaType === "image" ? `![生成图片](<${url}>)` : `[${asset.mediaType === "audio" ? "播放生成音频" : "查看生成视频"}](<${url}>)`;
          return `${preview}\n工作区文件：${asset.path}`;
        }).join("\n\n");
        return { content: [{ type: "text", text: jobId ? `generationId=${jobId}\n${text}` : text }], details: result };
      },
    }))];
  },
};

export default plugin;
