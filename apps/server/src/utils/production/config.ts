// 制作配置：出图直接调 Qwen 图像 API。出视频可选 AutoDL 上的 ComfyUI，或本机已启动的 ComfyUI。
import conf from "@/utils/conf";

export type ProductionConfig = {
  videoHost: string;
  localComfyuiBaseUrl: string;
  comfyuiBaseUrl: string;
  comfyuiServiceField: string;
  comfyuiScheme: string;
  workflowRoot: string;
  imageSource: string;
  imageProviderId: string;
  imageModelId: string;
  /** comfyui：本地/AutoDL 工作流；videoModel：设置「视频模型」云 API */
  videoProviderId: "comfyui" | "videoModel";
  videoWorkflow: string;
  autodlBaseUrl: string;
  autodlToken: string;
  autodlInstanceUuid: string;
  autodlStartCommand: string;
  autodlEnsureRunning: boolean;
  /** 成片画面质检模型（语言模型供应商里的 model id） */
  videoQcModelId: string;
  /** 成片音轨质检模型 */
  audioQcModelId: string;
};

const defaults: ProductionConfig = {
  videoHost: "autodl",
  localComfyuiBaseUrl: "http://127.0.0.1:8188",
  comfyuiBaseUrl: "",
  comfyuiServiceField: "service_6006_domain",
  comfyuiScheme: "https",
  workflowRoot: "",
  imageSource: "qwen",
  imageProviderId: "qwenImage",
  imageModelId: "qwen-image-3.0-pro",
  videoProviderId: "comfyui",
  videoWorkflow: "video/h3_ref2va_1080p",
  autodlBaseUrl: "https://www.autodl.art",
  autodlToken: "",
  autodlInstanceUuid: "",
  autodlStartCommand: "",
  autodlEnsureRunning: true,
  videoQcModelId: "qwen3.8-omni-flash",
  audioQcModelId: "qwen3.8-omni-flash",
};

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

export function readProduction(): ProductionConfig {
  const raw = conf.get("settings.production", {});
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    videoHost: source.videoHost === "local" ? "local" : defaults.videoHost,
    localComfyuiBaseUrl: text(source.localComfyuiBaseUrl, "") || defaults.localComfyuiBaseUrl,
    comfyuiBaseUrl: localDefault(text(source.comfyuiBaseUrl, "")),
    comfyuiServiceField: fieldName(source.comfyuiServiceField),
    comfyuiScheme: text(source.comfyuiScheme, defaults.comfyuiScheme) === "http" ? "http" : "https",
    workflowRoot: text(source.workflowRoot, ""),
    imageSource: defaults.imageSource,
    imageProviderId: text(source.imageProviderId, "") || defaults.imageProviderId,
    imageModelId: text(source.imageModelId, "") || defaults.imageModelId,
    videoProviderId: source.videoProviderId === "videoModel" ? "videoModel" : "comfyui",
    videoWorkflow: text(source.videoWorkflow, "") || defaults.videoWorkflow,
    autodlBaseUrl: text(source.autodlBaseUrl, defaults.autodlBaseUrl) || defaults.autodlBaseUrl,
    autodlToken: text(source.autodlToken, ""),
    autodlInstanceUuid: text(source.autodlInstanceUuid, ""),
    autodlStartCommand: text(source.autodlStartCommand, ""),
    autodlEnsureRunning: source.autodlEnsureRunning === undefined ? true : source.autodlEnsureRunning === true,
    videoQcModelId: text(source.videoQcModelId, "") || defaults.videoQcModelId,
    audioQcModelId: text(source.audioQcModelId, "") || defaults.audioQcModelId,
  };
}

function localDefault(value: string) {
  if (value === "http://127.0.0.1:8188" || value === "http://localhost:8188") return "";
  return value;
}

function fieldName(value: unknown) {
  const textValue = text(value, defaults.comfyuiServiceField);
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(textValue) ? textValue : defaults.comfyuiServiceField;
}

export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
