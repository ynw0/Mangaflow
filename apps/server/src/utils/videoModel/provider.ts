// 复用 apiMart 的 Wan 视频生成实现；不把 apimart 装进媒体模型列表。
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readFile } from "@toonflow/file";
import { loadMediaProviderSource } from "@/utils/media/provider";
import type { VideoModelConfig } from "@/utils/videoModel/config";
import type { MediaModel } from "@toonflow/tools-scaffold/runtime";

function apiMartSourcePath() {
  const candidates = [
    resolve(import.meta.dirname, "../../../../../packages/providers/src/media/apiMart.ts"),
    resolve(import.meta.dirname, "../../../../packages/providers/src/media/apiMart.ts"),
    resolve(process.cwd(), "packages/providers/src/media/apiMart.ts"),
  ];
  const path = candidates.find(item => existsSync(item));
  if (!path) throw Object.assign(new Error("未找到 apiMart 适配器源码"), { status: 500 });
  return path;
}

export async function loadVideoModelProvider(config: VideoModelConfig, signal?: AbortSignal, cwd?: string) {
  const source = await readFile(apiMartSourcePath(), "utf8");
  return loadMediaProviderSource(source, {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  }, signal, undefined, cwd);
}

export function videoModelAsMediaModel(config: VideoModelConfig): MediaModel {
  const durations = Array.from({ length: 29 }, (_, index) => index + 2);
  return {
    providerId: "videoModel",
    providerLabel: "视频模型",
    modelId: config.modelId,
    label: config.modelId === "wan3.0-video" ? "Wan3.0" : config.modelId,
    type: "video",
    supportsPrice: false,
    mode: ["text", "startFrameOptional", ["imageReference:10", "videoReference:5", "audioReference:5"]],
    audio: true,
    durationResolutionMap: [{ duration: durations, resolution: ["480P", "720P", "1080p"] }],
  };
}
