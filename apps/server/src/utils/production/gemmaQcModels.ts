import { createHash } from "node:crypto";
import { fail, readProduction, type ComfyHost, type ProductionConfig } from "@/utils/production/config";
import { readNodeChoices } from "@/utils/production/comfyui";
import { resolveComfyBaseUrl } from "@/utils/production/autodl";

export const gemmaWorkflowId = "qc/gemma4";
export const gemmaModelPrefix = "qc/gemma4:";
export function isGemmaQcId(id: string) { return /^qc\/gemma4/i.test(id); }
export function gemmaModelFile(id: string) { return id.startsWith(gemmaModelPrefix) ? id.slice(gemmaModelPrefix.length) : undefined; }
export function isGemmaModelFile(name: string) {
  const file = name.split(/[\\/]/).at(-1) ?? "";
  return name.length <= 512 && !/[\x00-\x1f]/.test(name) && !name.startsWith("[") && /^gemma[-_]?4(?:[-_.]|$)/i.test(file) && /\.safetensors$/i.test(file)
    && !/(?:mmproj|vision[_-]?tower|audio[_-]?encoder|projector|mtp|embed[_-]?tokens)/i.test(file);
}
export function gemmaTargetId(config: ProductionConfig, host: ComfyHost = config.gemmaQcHost) {
  const identity = host === "local" ? [host, config.localComfyuiBaseUrl] :
    [host, config.autodlBaseUrl, config.autodlInstanceUuid, config.comfyuiBaseUrl, config.comfyuiServiceField, config.comfyuiScheme];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
export function isGemmaModelEnabled(config: ProductionConfig, file: string, host: ComfyHost = config.gemmaQcHost) {
  return !config.disabledWorkflowIds.includes(gemmaWorkflowId) &&
    config.enabledGemmaQcModels[gemmaTargetId(config, host)]?.includes(file) === true;
}
export function assertGemmaModelEnabled(config: ProductionConfig, id: string) {
  const file = gemmaModelFile(id);
  if (!file || !isGemmaModelFile(file)) fail("旧版 Gemma 质检未指定实际模型文件，请在工作流设置刷新、启用并重新选择权重。");
  if (!isGemmaModelEnabled(config, file)) fail("所选 Gemma 模型未在当前质检实例启用，请检查工作流设置。");
  return file;
}
export async function discoverGemmaQcModels(host: ComfyHost, signal?: AbortSignal) {
  const config = readProduction();
  const targetId = gemmaTargetId(config, host);
  const baseUrl = await resolveComfyBaseUrl(signal, host, false, config);
  const names = await readNodeChoices(baseUrl, "CLIPLoader", "clip_name", signal);
  return { host, targetId, models: [...new Set(names.filter(isGemmaModelFile))].sort((a,b) => a.localeCompare(b)).map(file => ({
    file, id: gemmaModelPrefix + file, label: file, enabled: isGemmaModelEnabled(config, file, host),
    precision: /bf16/i.test(file) ? "BF16" : /fp16/i.test(file) ? "FP16" : /int8/i.test(file) ? "INT8" : /fp8/i.test(file) ? "FP8" : "未知",
  })) };
}
