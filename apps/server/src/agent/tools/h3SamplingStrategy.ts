import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isEnabled } from "@/utils/skills/files";

export const preferred4StepLora = "minimax_h3_ref2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors";
const knownSpecial = /(?:^|[_/.-])(pdd|ptd|hyperflow)(?:[_/.-]|$)/i;
const normalize = (value: string) => value.replaceAll("\\", "/").toLowerCase();
const basename = (value: string) => normalize(value).split("/").at(-1) ?? "";
const declaredSteps = (value: string) => {
  const file = basename(value);
  const match = file.match(/(\d{1,2})[\s._-]*steps?/i) ?? file.match(/steps?[\s._-]*(\d{1,2})/i);
  return match ? Number(match[1]) : undefined;
};
const extraSchema = z.strictObject({ name: z.string().trim().min(1).max(512), strength: z.number().min(0.01).max(2) });
const advancedSchema = z.strictObject({
  loraStrength: z.number().min(0.01).max(2).optional(),
  extraLoras: z.array(extraSchema).max(3).optional(),
  sampler: z.string().min(1).optional(), scheduler: z.string().min(1).optional(),
  videoShift: z.number().min(0.1).max(30).optional(), audioShift: z.number().min(0.1).max(30).optional(),
});
export const h3SamplingStrategyInput = z.strictObject({
  intent: z.enum(["auto", "preview4", "quick44", "quick62", "quality", "fused8"]).default("auto"),
  phase: z.enum(["preview", "normal", "motion", "key", "final"]).describe("从镜头合同及制作阶段提取；不要将正式镜头改为极速试镜"),
  checkpointName: z.string().trim().min(1).max(512),
  checkpointKind: z.enum(["standard", "fused", "unknown"]).describe("需要依据已确认的模型资料或工作流，不得仅凭 turbo 字符猜测"),
  isRef2vaWorkflow: z.boolean().describe("根据 getConfig 模型能力判断是否为 H3 双采 Ref2VA"),
  loraChoices: z.array(z.string().min(1).max(512)).max(1000),
  selectedLora: z.string().max(512).optional().default(""),
  manualAccelerationLoras: z.array(z.string().max(512)).max(32).optional(),
  extraLoras: z.array(extraSchema).max(3).optional(),
  primaryStrength: z.number().min(0.01).max(2).optional(),
  samplerChoices: z.array(z.string().min(1).max(128)).max(500),
  samplerPreference: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/).optional().describe("若有官方或实际已验证的采样器配置，请传入；未确认时不要猜测"),
  schedulerChoices: z.array(z.string().min(1).max(128)).max(100),
  maxExtraLoras: z.number().int().min(0).max(3).optional().default(3),
  compatibilityConfirmed: z.boolean().default(false).describe("仅在已有成功的同主模型+LoRA+工作流试片或可靠配置证据时设为 true；不能根据文件名推测"),
  qualitySteps: z.number().int().min(25).max(40).optional().describe("仅质量档自定义总步数，最多 40；不影响预设按钮"),
});
export type H3SamplingStrategyInput = z.infer<typeof h3SamplingStrategyInput>;

export type H3SamplingDecision = {
  status: "ready" | "experimental" | "blocked";
  preset: "preview4" | "quick44" | "quick62" | "quality" | "fused8";
  reason: string;
  warning?: string;
  setConfig?: {
    firstPassSteps: number; secondPassSteps: number; loraName: string;
    h3Options: { sampler: string; scheduler: string; videoShift: number; audioShift: number;
      extraLoras: { name: string; strength: number }[]; loraStrength?: number };
  };
  totalSteps?: number;
};

export function planH3Sampling(input: H3SamplingStrategyInput): H3SamplingDecision {
  const desired = input.intent === "auto"
    ? input.phase === "preview" ? "preview4"
      : input.phase === "motion" ? "quick62"
      : input.phase === "key" || input.phase === "final" ? "quality" : "quick44"
    : input.intent;
  const blocked = (reason: string): H3SamplingDecision => ({ status: "blocked", preset: desired, reason });
  if (!input.isRef2vaWorkflow) return blocked("该模型不属于已支持的 H3 Ref2VA 双采工作流，不自动选档。");
  if (input.checkpointKind === "unknown") return blocked("主模型类型尚未确认，不能根据文件名推断是否融合 Turbo。");
  if (desired === "fused8" && input.checkpointKind !== "fused") return blocked("当前并非已验证的融合 Turbo 主模型。");
  if (desired !== "fused8" && input.checkpointKind === "fused") return blocked("已融合 Turbo 的主模型只允许选择融合档位，不能叠加普通加速 LoRA。");

  const manual = new Set((input.manualAccelerationLoras ?? []).map(normalize));
  const acceleration = (name: string) => !!name && (manual.has(normalize(name)) || /turbo/i.test(basename(name))
    || declaredSteps(name) !== undefined || /(?:^|[_.-])step(?:[_.-]|$)/i.test(basename(name)));
  const extras = (input.extraLoras ?? []).filter(item => !acceleration(item.name));
  const primaryOrdinary = input.selectedLora && !acceleration(input.selectedLora) ? input.selectedLora : "";
  if (primaryOrdinary && !extras.some(item => normalize(item.name) === normalize(primaryOrdinary))) {
    if (extras.length >= input.maxExtraLoras) return blocked("普通主槽 LoRA 无法迁入附加槽：附加列表已满。请先手动调整，防止风格丢失。");
    extras.unshift({ name: primaryOrdinary, strength: input.primaryStrength ?? 1 });
  }
  const chooseSampler = (names: readonly string[]) => names.find(name => input.samplerChoices.includes(name));
  const scheduler = input.schedulerChoices.includes("simple") ? "simple" : undefined;
  if (!scheduler) return blocked("ComfyUI 未提供 simple 调度器；不能可靠应用当前 H3 采样策略。");
  let loraName = "";
  let totalSteps = 25, firstPassSteps = 20, secondPassSteps = 5;
  let sampler = chooseSampler(["res_multistep", "euler"]);
  let status: H3SamplingDecision["status"] = "ready";
  let warning: string | undefined;
  if (desired === "quality") {
    totalSteps = input.qualitySteps ?? (input.phase === "final" ? 35 : input.phase === "key" ? 30 : 25);
    // 25=20+5, 30=24+6, 35=28+7, 40=32+8。总步数最大 40。
    firstPassSteps = totalSteps - Math.round(totalSteps / 5);
    secondPassSteps = totalSteps - firstPassSteps;
    if (!sampler) return blocked("当前工作流没有 res_multistep 或 euler，不能给出质量档预设。");
  } else if (desired === "fused8") {
    if (!input.compatibilityConfirmed) return blocked("融合 Turbo 8 步需要同主模型与工作流的兼容性验证记录。");
    sampler = chooseSampler(["euler"]);
    totalSteps = 8; firstPassSteps = 4; secondPassSteps = 4;
  } else {
    const targetSteps = desired === "preview4" ? 4 : 8;
    if (targetSteps === 4) {
      // 只优先官方 Ref2V 4-step ComfyUI BF16；禁止把 TaoMate 3step 当作 4-step 正式候选。
      loraName = input.loraChoices.find(name => basename(name) === preferred4StepLora) ?? "";
      if (!loraName) return blocked("未在已安装 LoRA 列表找到 LightX2V Ref2VA 4-step v1.0 ComfyUI BF16；不以 3step LoRA 冒充。");
    } else {
      const candidates = input.loraChoices.filter(name => declaredSteps(name) === 8 && !knownSpecial.test(basename(name)));
      const selected = candidates.find(name => normalize(name) === normalize(input.selectedLora));
      const lightxV11 = candidates.filter(name => basename(name) === "minimax_h3_ref2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors");
      if (selected) loraName = selected;
      else if (candidates.length === 1) loraName = candidates[0]!;
      else if (input.compatibilityConfirmed && lightxV11.length === 1) loraName = lightxV11[0]!;
      else if (input.intent === "auto" && candidates.length === 0) {
        // 自动模式不能为了追求速度把正式镜头回退至4步；用常规25步保守完成。
        return planH3Sampling({ ...input, intent: "quality", qualitySteps: input.qualitySteps ?? 25 });
      } else return blocked(candidates.length ? "存在多个 8-step LoRA，请明确选择已验证兼容的版本；不能凭文件名随意叠加。" : "未找到明确声明 8step 的普通加速 LoRA；PDD/PTD/HyperFlow 不能通过普通加载器替代。");
    }
    if (!input.compatibilityConfirmed && targetSteps === 8) {
      // 质量要求高的正式镜头不得仅凭文件名自动切换至尚未验证的加速器。
      if (input.intent === "auto") {
        return planH3Sampling({ ...input, intent: "quality", qualitySteps: input.qualitySteps ?? 25 });
      }
      status = "experimental";
      warning = "尚未核验主模型、LoRA 与二采调度兼容性，只能做明确授权的试验，不能当作正式质量承诺。";
    }
    if (!input.compatibilityConfirmed && targetSteps === 4) {
      status = "experimental";
      warning = "4 步仅用于低步数快速试镜；主模型与 LoRA 仍需实机验证，不能直接作为正式成片。";
    }
    // LightX2V ComfyUI Ref2V 用 Euler；Pika/其他8step 保留其验证过的采样器，否则优先当前双采默认 res_multistep。
    if (input.samplerPreference && !input.samplerChoices.includes(input.samplerPreference)) {
      return blocked("指定的采样器未在 ComfyUI 可选列表中，不能强行应用。");
    }
    sampler = input.samplerPreference ?? (basename(loraName).startsWith("minimax_h3_ref2v_turbo_")
      ? chooseSampler(["euler"])
      : chooseSampler(["res_multistep", "euler"]));
    totalSteps = targetSteps;
    firstPassSteps = desired === "quick62" ? 6 : targetSteps === 4 ? 2 : 4;
    secondPassSteps = totalSteps - firstPassSteps;
  }
  if (!sampler) return blocked("当前 ComfyUI 采样器不支持此方案，不能猜测替换。");
  return {
    status, preset: desired,
    reason: desired === "preview4" ? "极速试镜，用于验证画面方向、参考和镜头方案，不作为默认成片"
      : desired === "quick44" ? "普通叙事快速出片，8 步 4+4；高分辨率阶段保留较多采样预算"
      : desired === "quick62" ? "运动和结构优先试验，8 步 6+2；不保证动作表现必然优于 4+4"
      : desired === "quality" ? "25～40 步质量优先；仅关闭加速 LoRA，保留普通 LoRA"
      : "仅适用于确认融合 Turbo 权重的主模型，不额外加载加速 LoRA",
    ...(warning ? { warning } : {}),
    totalSteps,
    setConfig: { loraName, firstPassSteps, secondPassSteps, h3Options: {
      sampler, scheduler, videoShift: 12, audioShift: 3, extraLoras: extras,
      ...(loraName ? { loraStrength: 1 } : {}),
    } },
  };
}

export function createH3SamplingStrategyTool(): ToolDefinition {
  return {
    name: "suggestH3Sampling", label: "H3 智能选档（只读）",
    description: "根据已读取的视频节点 getConfig 和镜头合同，建议 4 步快速试镜、8 步 4+4/6+2、25～40 步质量或融合 Turbo 档；只返回供 node:setConfig 使用的参数，不提交生成、不自动变更画布。启用 h3SamplingStrategy Skill 才可使用。",
    promptSnippet: "视频节点在自动或目标制作模式下，若启用了 h3SamplingStrategy，先读 SKILL.md，再用 suggestH3Sampling 评估，再按结果调用节点 setConfig；非兼容模型不要猜文件名。",
    parameters: z.toJSONSchema(h3SamplingStrategyInput, { io: "input", target: "draft-07" }),
    executionMode: "sequential",
    async execute(_id, raw, signal) {
      signal?.throwIfAborted();
      if (!isEnabled("h3SamplingStrategy")) throw new Error("H3 智能采样 Skill 已关闭，不能使用配套工具。");
      const details = planH3Sampling(h3SamplingStrategyInput.parse(raw));
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  };
}
