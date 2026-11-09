import { z } from "zod";
import type { ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import { agentVideoQcSubmissionSchema, audioGenerationSchema, imageGenerationSchema, listMediaModelsSchema, qcVideoSchema, videoGenerationSchema, videoQcStatusSchema } from "./runtime";

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
      { name: "generateVideo", mediaType: "video", enabled: permissions.allowVideo, label: "生成视频", parameters: videoGenerationSchema, description: "根据提示词和可选的工作区图片、视频、音频、首尾帧生成视频。H3 必须使用服务端审核通过后返回的 generationRequest 和 reviewId：内置 Agent 用 draftVideoPrompt，外部 Agent 用 videoPrompt 的 prepare/inspect/submit。修改提示词、参考、工作流或有效参数后重新审核。固定与固定上次随机须传具体 seed；随机模式传 seedMode=random。按模型能力设置生成模式、时长、分辨率和音频。用户没指定采样时不要传 megapixels、upscale、firstPassSteps、secondPassSteps，二采默认百万像素 0.2、放大 2、一采 8 步、二采 4 步。" },
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
      description: "按设置发起成片验收。主 Agent 抽帧模式会返回 awaitingAgent，随后必须调用 getVideoQcFrames 看图并用 submitVideoQc 提交逐项结论。专用 QC 模式返回模型结论；组合模式还需主 Agent 看帧。checklist 为额外验收要点，不替代已审合同。",
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
      description: "按工作区内成片相对路径读取持久化质检状态。已完成时返回逐项结果；此操作不启动质检。",
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
      description: "读取 awaitingAgent 成片的真实画面帧、时间戳、证据版本与强制验收项。必须实际看图后提交结论；静态帧无法证明的动作或声音标未验证。此操作不启动模型或生成视频。",
      parameters: z.toJSONSchema(videoQcStatusSchema, { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const { videoPath } = videoQcStatusSchema.parse(params);
        const { evidence, images } = await media.getAgentVideoQcEvidence(videoPath);
        return { details: evidence, content: [{ type: "text" as const, text: JSON.stringify({ ...evidence, nextAction: "看完实际图片，按 requirementId 逐项用 submitVideoQc 提交；不能把路径当成已看图证据。" }) },
          ...images.flatMap((image, index) => [{ type: "text" as const, text: `第 ${index + 1} 帧，${evidence.frames[index]!.time.toFixed(3)} 秒` }, { type: "image" as const, ...image }])] };
      },
    };
    const submitTool: ToolDefinition = {
      name: "submitVideoQc", label: "提交主 Agent 质检结论",
      description: "看过 getVideoQcFrames 返回的实际图片后，携带相同 revision 提交逐项画面结论。不得提交总通过来代替验收项；缺项或证据不足会保持未验证。没有听辨音轨时不得声称音频通过。",
      parameters: z.toJSONSchema(agentVideoQcSubmissionSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const result = await media.submitAgentVideoQc(agentVideoQcSubmissionSchema.parse(params));
        return { details: result, content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    };
    return [qcTool, qcStatusTool, framesTool, submitTool, ...(generationTools.length ? [listTool] : []), ...generationTools.map<ToolDefinition>(operation => ({
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
