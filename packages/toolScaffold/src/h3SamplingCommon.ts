/** Shared classification only; UI manual experiments and Agent automatic approvals remain separate policies. */
export const preferred4StepLora = "minimax_h3_ref2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors";
export const normalizeH3LoraName = (name: string) => name.replaceAll("\\", "/").toLowerCase();
export const basenameH3Lora = (name: string) => normalizeH3LoraName(name).split("/").at(-1) ?? "";
export function declaredAccelerationSteps(name: string): number | undefined {
  const file = basenameH3Lora(name);
  const match = file.match(/(\d{1,2})[\s._-]*steps?/i) ?? file.match(/steps?[\s._-]*(\d{1,2})/i);
  return match ? Number(match[1]) : undefined;
}
export function isAccelerationLora(name: string, manual: readonly string[] = []): boolean {
  const file = basenameH3Lora(name);
  return !!name && (manual.some(item => normalizeH3LoraName(item) === normalizeH3LoraName(name))
    || /turbo/i.test(file) || declaredAccelerationSteps(name) !== undefined
    || /(?:^|[\s._-])steps?(?:$|[\s._-])/i.test(file));
}
export function isSpecializedAccelerationLora(name: string): boolean {
  return /(?:^|[_/.-])(pdd|ptd|hyperflow)(?:[_/.-]|$)/i.test(normalizeH3LoraName(name));
}
