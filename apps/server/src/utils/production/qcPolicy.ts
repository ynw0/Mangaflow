import type { NodeQcOverride } from "@toonflow/tools-scaffold/runtime";
import { fail, readProduction, type ProductionConfig } from "@/utils/production/config";
import { gemmaTargetId, isGemmaQcId } from "@/utils/production/gemmaQcModels";

export type QcPolicySnapshot = Pick<ProductionConfig, "qcMethod" | "qcLevel" | "qcTrigger" | "videoQcModelId" | "audioQcModelId" | "gemmaQcHost"> & { contractVersion: 4; gemmaTargetId: string };

export function captureQcPolicy(override?: NodeQcOverride, config = readProduction()): QcPolicySnapshot {
  const custom = override?.mode === "custom" ? override : undefined;
  const qcMethod = custom?.qcMethod ?? config.qcMethod;
  const qcLevel = custom?.qcLevel ?? config.qcLevel;
  const qcTrigger = override?.mode === "off" || qcLevel === "none" ? "manual" : custom?.qcTrigger ?? config.qcTrigger;
  let videoQcModelId = custom?.videoQcModelId ?? config.videoQcModelId;
  let audioQcModelId = custom?.audioQcModelId ?? config.audioQcModelId;
  if (qcLevel === "videoAudio" && qcMethod !== "agentFrames") {
    // 同一个 Gemma 同时看画面和听音轨，禁止两种模型混合后静默替换。
    if (custom?.videoQcModelId && isGemmaQcId(videoQcModelId) && !custom.audioQcModelId) audioQcModelId = videoQcModelId;
    if (custom?.audioQcModelId && isGemmaQcId(audioQcModelId) && !custom.videoQcModelId) videoQcModelId = audioQcModelId;
    if ((isGemmaQcId(videoQcModelId) || isGemmaQcId(audioQcModelId)) && videoQcModelId !== audioQcModelId) {
      // 旧全局设置曾允许音轨选 Gemma 并自动合并；仅对无覆盖的旧配置保留原行为。
      if (custom) fail("画面和音轨采用 Gemma 时，请选择同一个实际模型文件。");
      videoQcModelId = audioQcModelId = isGemmaQcId(videoQcModelId) ? videoQcModelId : audioQcModelId;
    }
  }
  return { qcMethod, qcLevel, qcTrigger, videoQcModelId, audioQcModelId, gemmaQcHost: config.gemmaQcHost, gemmaTargetId: gemmaTargetId(config), contractVersion: 4 };
}

export function policyUsesModel(policy: QcPolicySnapshot, automatic: boolean) {
  return policy.qcLevel !== "none" && policy.qcMethod !== "agentFrames" && (!automatic || policy.qcTrigger === "auto");
}

export function assertQcCallAllowed(policy: QcPolicySnapshot, allowed: boolean | undefined, automatic: boolean) {
  if (allowed === false && policyUsesModel(policy, automatic)) fail("当前成片质检会额外调用专用模型，请明确授权并传 modelCallConfirmed=true。", 403);
}

export function productionForQc(policy: QcPolicySnapshot, config = readProduction()): ProductionConfig {
  const gemma = policy.qcMethod !== "agentFrames" && policy.qcLevel !== "none" &&
    (isGemmaQcId(policy.videoQcModelId) || policy.qcLevel === "videoAudio" && isGemmaQcId(policy.audioQcModelId));
  if (gemma && (config.gemmaQcHost !== policy.gemmaQcHost || gemmaTargetId(config) !== policy.gemmaTargetId)) {
    fail("原质检实例已变化，请明确重新选择质检配置；禁止自动切换实例。", 409);
  }
  return { ...config, qcMethod: policy.qcMethod, qcLevel: policy.qcLevel, qcTrigger: policy.qcTrigger,
    videoQcModelId: policy.videoQcModelId, audioQcModelId: policy.audioQcModelId, gemmaQcHost: policy.gemmaQcHost };
}
