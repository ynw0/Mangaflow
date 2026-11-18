/** H3 二采预设：底层识别与 Agent 共享；手动实验档可提示风险而 Agent 自动档必须验证。 */
import { preferred4StepLora, normalizeH3LoraName as normalize, basenameH3Lora as basename,
  declaredAccelerationSteps, isAccelerationLora } from "@toonflow/nodes-scaffold/h3Sampling";
export { preferred4StepLora, declaredAccelerationSteps, isAccelerationLora } from "@toonflow/nodes-scaffold/h3Sampling";
export type H3SamplingPreset = "normal" | "preview4" | "balanced82" | "balanced84" | "quick62" | "fused8";
export type ExtraLora = { name: string; strength: number };
export type H3PresetInput = {
  installedLoras: readonly string[];
  /** Names explicitly marked as accelerator LoRAs in this canvas node; does not guarantee compatibility. */
  manualAccelerationLoras?: readonly string[];
  primaryLora: string;
  primaryStrength: number;
  extraLoras: readonly ExtraLora[];
  maxExtraLoras: number;
  turboCheckpoint: boolean;
  eulerAvailable: boolean;
};
export type H3PresetPlan =
  | { ok: true; primaryLora: string; primaryStrength?: number; extraLoras: ExtraLora[];
      firstPassSteps: number; secondPassSteps: number; sampler: string; hint: string }
  | { ok: false; reason: string };

function compatibleWith(name: string, steps: 4 | 8, manual: readonly string[]) {
  if (!isAccelerationLora(name, manual)) return false;
  const declared = declaredAccelerationSteps(name);
  return declared === undefined || (steps === 4 ? declared === 4 : declared === 8);
}
function speedCandidate(installed: readonly string[], selected: string, steps: 4 | 8, manual: readonly string[]):
  { name: string } | { reason: string } {
  const options = [...new Map(installed.filter(name => compatibleWith(name, steps, manual))
    .map(name => [normalize(name), name])).values()];
  const chosen = options.find(name => normalize(name) === normalize(selected));
  if (steps === 4) {
    const lightx = options.find(name => basename(name) === preferred4StepLora);
    if (lightx) return { name: lightx };
    return { reason: "极速样片需要已安装的 LightX2V MiniMax H3 Ref2V 4-step v1.0 ComfyUI BF16，不能用 TaoMate 3step 替代。" };
  }
  if (chosen) return { name: chosen };
  const explicit = options.filter(name => declaredAccelerationSteps(name) !== undefined);
  if (explicit.length === 1) return { name: explicit[0]! };
  if (explicit.length > 1) return { reason: "检测到多个适用 " + steps + " 步的加速 LoRA，请先在加速 LoRA 下拉框中明确选择。" };
  if (options.length === 1) return { name: options[0]! };
  if (options.length > 1) return { reason: "检测到多个未注明步数的 Turbo LoRA，请手动选择兼容 " + steps + " 步的版本。" };
  return { reason: "未在当前 ComfyUI 列表识别到兼容 " + steps + " 步的加速 LoRA；请检查模型文件并刷新列表。" };
}
export function createH3PresetPlan(preset: H3SamplingPreset, input: H3PresetInput): H3PresetPlan {
  if (input.turboCheckpoint && preset !== "fused8") {
    return { ok: false, reason: "当前为 Turbo 主模型；普通及 LoRA 加速档需要先选择普通 H3 主模型。" };
  }
  if (!input.turboCheckpoint && preset === "fused8") {
    return { ok: false, reason: "请先选择已经融合 Turbo 的 H3 主模型。" };
  }
  if (preset === "fused8" && !input.eulerAvailable) {
    return { ok: false, reason: "未检测到 euler 采样器，请刷新 ComfyUI 采样器列表。" };
  }
  const manual = input.manualAccelerationLoras ?? [];
  const ordinaryExtras = input.extraLoras.filter(item => !isAccelerationLora(item.name, manual)).map(item => ({ ...item }));
  let primaryLora = isAccelerationLora(input.primaryLora, manual) ? "" : input.primaryLora;
  let primaryStrength = primaryLora ? input.primaryStrength : undefined;
  let firstPassSteps = 20, secondPassSteps = 5, sampler = "res_multistep";
  let hint = "已切换普通 25 步，仅关闭加速 LoRA，保留普通 LoRA。";
  if (preset === "fused8") {
    firstPassSteps = 6;
    secondPassSteps = 2;
    sampler = "euler";
    hint = "已切换融合 Turbo 8 步，仅关闭加速 LoRA，保留普通 LoRA。";
  } else if (preset === "balanced82" || preset === "balanced84") {
    firstPassSteps = 8;
    secondPassSteps = preset === "balanced82" ? 2 : 4;
    hint = "已切换无加速双采。";
  } else if (preset !== "normal") {
    const target: 4 | 8 = preset === "preview4" ? 4 : 8;
    const candidate = speedCandidate(input.installedLoras, input.primaryLora, target, manual);
    if ("reason" in candidate) return { ok: false, reason: candidate.reason };
    // 兼容旧项目：普通 LoRA 处于主槽时，切加速档前迁入附加槽，防止静默丢失。
    if (primaryLora && normalize(primaryLora) !== normalize(candidate.name)
      && !ordinaryExtras.some(item => normalize(item.name) === normalize(primaryLora))) {
      if (ordinaryExtras.length >= input.maxExtraLoras) {
        return { ok: false, reason: "旧项目主槽是普通 LoRA，但附加 LoRA 已满；请先整理附加列表，避免切档时丢失风格。" };
      }
      ordinaryExtras.unshift({ name: primaryLora, strength: input.primaryStrength });
    }
    primaryLora = candidate.name;
    primaryStrength = 1;
    const lightxRef = basename(candidate.name).startsWith("minimax_h3_ref2v_turbo_");
    if (lightxRef) {
      if (!input.eulerAvailable) return { ok: false, reason: "LightX2V Ref2V Turbo 需要 Euler 采样器，请刷新 ComfyUI 选项。" };
      sampler = "euler";
    }
    firstPassSteps = preset === "preview4" ? 2 : 6;
    secondPassSteps = 2;
    hint = "已选择 " + firstPassSteps + "+" + secondPassSteps + "，关闭其它加速 LoRA，保留普通 LoRA。";
    if (declaredAccelerationSteps(candidate.name) === undefined) {
      hint += " 此 LoRA 未声明适用步数，可能需要专用节点或调度器；手动标记不代表兼容，需要验证。";
    }
  }
  return { ok: true, primaryLora, ...(primaryStrength === undefined ? {} : { primaryStrength }),
    extraLoras: ordinaryExtras, firstPassSteps, secondPassSteps, sampler, hint };
}
