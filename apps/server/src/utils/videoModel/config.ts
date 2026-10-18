// 云视频模型设置：独立于媒体模型，密钥不写 mediaProviderConfigs。
import conf from "@/utils/conf";

export type VideoModelConfig = {
  baseUrl: string;
  apiKey: string;
  modelId: string;
};

export const defaultVideoModelBaseUrl = "https://api.apimart.ai/v1";
export const defaultVideoModelId = "wan3.0-video";

const defaults: VideoModelConfig = {
  baseUrl: defaultVideoModelBaseUrl,
  apiKey: "",
  modelId: defaultVideoModelId,
};

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

export function readVideoModel(): VideoModelConfig {
  const raw = conf.get("settings.videoModel", {});
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    baseUrl: text(source.baseUrl, "") || defaults.baseUrl,
    apiKey: text(source.apiKey, ""),
    modelId: text(source.modelId, "") || defaults.modelId,
  };
}

export function requireVideoModel(): VideoModelConfig {
  const config = readVideoModel();
  if (!config.baseUrl) {
    throw Object.assign(new Error("请先在设置「视频模型」中填写 API 地址"), { status: 400 });
  }
  if (!config.apiKey) {
    throw Object.assign(new Error("请先在设置「视频模型」中填写 API Key"), { status: 400 });
  }
  return config;
}
