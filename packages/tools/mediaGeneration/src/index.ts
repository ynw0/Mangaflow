import { z } from "zod";
import type { MediaContext, ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import { audioGenerationSchema, imageGenerationSchema, listMediaModelsSchema, qcVideoSchema, videoGenerationSchema } from "./runtime";

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
      { name: "generateVideo", mediaType: "video", enabled: permissions.allowVideo, label: "生成视频", parameters: videoGenerationSchema, description: "根据提示词和可选的工作区图片、视频、音频、首尾帧生成视频。按模型能力设置生成模式、时长、分辨率和音频。用户没指定采样时不要传 megapixels、upscale、firstPassSteps、secondPassSteps，二采默认百万像素 0.2、放大 2、一采 8 步、二采 4 步。" },
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
      description: "按设置里的画面质检模型和档位验收一条已生成的工作区视频。videoPath 为工作区相对路径，checklist 为可选验收要点。不选择模型，也不代替出视频。返回 status、findings 和实际使用的模型。",
      promptSnippet: "成片质检调用 qcVideo，传入工作区相对路径。模型、档位和是否听音轨以设置为准，不要用 ffmpeg 抽帧或静音检测代替。",
      parameters: z.toJSONSchema(qcVideoSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const result = await media.qcVideo(qcVideoSchema.parse(params), signal);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    };
    return [qcTool, ...(generationTools.length ? [listTool] : []), ...generationTools.map<ToolDefinition>(operation => ({
      name: operation.name,
      label: operation.label,
      description: `${operation.description}providerId 和 modelId 必须来自 listMediaModels。引用素材的 path 及 outputDirectory 均为工作区相对路径；省略输出目录使用默认媒体目录。等待生成完成后返回已保存的文件路径，不返回 Base64。`,
      promptSnippet: "生成媒体前先查询 listMediaModels。",
      parameters: z.toJSONSchema(operation.parameters, { io: "input", target: "draft-07" }),
      executionMode: "sequential" as const,
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const request = operation.parameters.parse(params);
        const result = await media[operation.name](request, signal);
        const text = result.map(asset => {
          const url = asset.path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
          const preview = asset.mediaType === "image" ? `![生成图片](<${url}>)` : `[${asset.mediaType === "audio" ? "播放生成音频" : "查看生成视频"}](<${url}>)`;
          return `${preview}\n工作区文件：${asset.path}`;
        }).join("\n\n");
        return { content: [{ type: "text", text }], details: result };
      },
    }))];
  },
};

export default plugin;
