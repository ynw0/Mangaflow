// 制作配置：出图可选 Qwen 图像 API 或 ComfyUI 工作流。出视频可选 AutoDL 上的 ComfyUI，或本机已启动的 ComfyUI。
import conf from "@/utils/conf";

export type ProductionConfig = {
  videoHost: string;
  localComfyuiBaseUrl: string;
  comfyuiBaseUrl: string;
  comfyuiServiceField: string;
  comfyuiScheme: string;
  workflowRoot: string;
  imageSource: "qwen" | "comfyui";
  imageProviderId: string;
  imageModelId: string;
  /** 无参考图时使用的出图工作流 */
  imageT2iWorkflow: string;
  /** 有参考图、且当前工作流不接收图片时使用的图像编辑工作流 */
  imageEditWorkflow: string;
  /** 设置里关掉的工作流。未列出的都开启 */
  disabledWorkflowIds: string[];
  /** comfyui：本地/AutoDL 工作流；videoModel：设置「视频模型」云 API */
  videoProviderId: "comfyui" | "videoModel";
  videoWorkflow: string;
  autodlBaseUrl: string;
  autodlToken: string;
  autodlInstanceUuid: string;
  autodlStartCommand: string;
  autodlEnsureRunning: boolean;
  /** 成片画面质检模型（语言模型供应商里的 model id，或本机 Gemma 工作流 id） */
  videoQcModelId: string;
  /** 成片音轨质检模型（语言模型 id，或本机 Gemma 工作流 id） */
  audioQcModelId: string;
  /** 质检档位：只视频、视频加音频、不质检（人工） */
  qcLevel: "video" | "videoAudio" | "none";
  /** 生成视频后是否自动质检 */
  qcTrigger: "auto" | "manual";
  /** 出图推进：自动自己看到完成，半自动有问题就问 */
  imageAdvanceMode: "auto" | "semi";
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
  imageT2iWorkflow: "image/flux3KleinT2i",
  imageEditWorkflow: "image/flux3KleinDistilledEdit",
  disabledWorkflowIds: [],
  videoProviderId: "comfyui",
  videoWorkflow: "video/h3_ref2va_1080p",
  autodlBaseUrl: "https://www.autodl.art",
  autodlToken: "",
  autodlInstanceUuid: "",
  autodlStartCommand: "",
  autodlEnsureRunning: true,
  videoQcModelId: "qwen3.8-omni-flash",
  audioQcModelId: "qwen3.8-omni-flash",
  qcLevel: "videoAudio",
  qcTrigger: "manual",
  imageAdvanceMode: "semi",
};

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

function workflowIdList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!/^(image|video|qc)\/[^/\\]{1,120}$/.test(id) || id.includes("..")) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 200);
}

export function isWorkflowEnabled(id: string) {
  return !readProduction().disabledWorkflowIds.includes(id);
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
    imageSource: source.imageSource === "comfyui" ? "comfyui" : "qwen",
    imageProviderId: text(source.imageProviderId, "") || defaults.imageProviderId,
    imageModelId: text(source.imageModelId, "") || defaults.imageModelId,
    imageT2iWorkflow: text(source.imageT2iWorkflow, "") || defaults.imageT2iWorkflow,
    imageEditWorkflow: text(source.imageEditWorkflow, "") || defaults.imageEditWorkflow,
    disabledWorkflowIds: workflowIdList(source.disabledWorkflowIds),
    videoProviderId: source.videoProviderId === "videoModel" ? "videoModel" : "comfyui",
    videoWorkflow: text(source.videoWorkflow, "") || defaults.videoWorkflow,
    autodlBaseUrl: text(source.autodlBaseUrl, defaults.autodlBaseUrl) || defaults.autodlBaseUrl,
    autodlToken: text(source.autodlToken, ""),
    autodlInstanceUuid: text(source.autodlInstanceUuid, ""),
    autodlStartCommand: text(source.autodlStartCommand, ""),
    autodlEnsureRunning: source.autodlEnsureRunning === undefined ? true : source.autodlEnsureRunning === true,
    videoQcModelId: text(source.videoQcModelId, "") || defaults.videoQcModelId,
    audioQcModelId: text(source.audioQcModelId, "") || defaults.audioQcModelId,
    qcLevel: source.qcLevel === "video" || source.qcLevel === "none" ? source.qcLevel : "videoAudio",
    qcTrigger: source.qcTrigger === "auto" ? "auto" : "manual",
    imageAdvanceMode: source.imageAdvanceMode === "auto" ? "auto" : "semi",
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
