import { describe, expect, test } from "bun:test";
import { createH3PresetPlan, declaredAccelerationSteps, isAccelerationLora, preferred4StepLora, type H3PresetInput } from "../src/components/h3SamplingPresets";

const input = (patch: Partial<H3PresetInput> = {}): H3PresetInput => ({
  installedLoras: ["speed/H3_TaoMate_3step.safetensors", "custom/pika-v2-turbo_8steps_hd.safetensors", "style/film.safetensors"],
  primaryLora: "speed/H3_TaoMate_3step.safetensors",
  primaryStrength: 0.8,
  extraLoras: [{ name: "style/film.safetensors", strength: 0.6 }],
  maxExtraLoras: 3, checkpointKind: "standard", samplerChoices: ["euler","res_multistep"], schedulerChoices: ["simple"], ...patch,
});
const success = (preset: Parameters<typeof createH3PresetPlan>[0], patch: Partial<H3PresetInput> = {}) => {
  const result = createH3PresetPlan(preset, input(patch));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
};

describe("H3 采样预设与加速 LoRA 识别", () => {
  test("识别 Turbo / step 命名，不依赖 Pika 固定文件名", () => {
    expect(isAccelerationLora("subdir\\randomH3Turbo_fp16.safetensors")).toBe(true);
    expect(isAccelerationLora("vendor/3-step-model.safetensors")).toBe(true);
    expect(isAccelerationLora("vendor/step_8.safetensors")).toBe(true);
    expect(isAccelerationLora("style/footsteps.safetensors")).toBe(false);
    expect(isAccelerationLora("style/cinematic.safetensors")).toBe(false);
    expect(declaredAccelerationSteps("other/8-steps.safetensors")).toBe(8);
    expect(declaredAccelerationSteps("foo/TaoMate-3step.safetensors")).toBe(3);
  });
  test("普通25步只移除加速 LoRA，保留非加速附加 LoRA", () => {
    const result = success("normal", {extraLoras:[
      {name:"speed/other_8step.safetensors",strength:1}, {name:"style/film.safetensors",strength:0.6}]});
    expect([result.firstPassSteps,result.secondPassSteps,result.primaryLora]).toEqual([20,5,""]);
    expect(result.extraLoras).toEqual([{name:"style/film.safetensors",strength:0.6}]);
    const ordinaryPrimary=success("normal",{primaryLora:"style/cinematic.safetensors",primaryStrength:0.45});
    expect([ordinaryPrimary.primaryLora,ordinaryPrimary.primaryStrength]).toEqual(["style/cinematic.safetensors",0.45]);
  });
  test("极速4步只选 LightX2V Ref2VA ComfyUI BF16；3step 不再自动候选", () => {
    expect(createH3PresetPlan("preview4", input()).ok).toBe(false);
    const result=success("preview4",{installedLoras:["minimax/"+preferred4StepLora,...input().installedLoras]});
    expect([result.firstPassSteps,result.secondPassSteps]).toEqual([2,2]);
    expect(result.primaryLora).toContain(preferred4StepLora);
    expect(result.extraLoras).toHaveLength(1);
  });
  test("LightX2V 4步使用 Euler，缺少 Euler 时禁用预设", () => {
    const present={installedLoras:["minimax/"+preferred4StepLora,...input().installedLoras]};
    expect(success("preview4",present).sampler).toBe("euler");
    expect(createH3PresetPlan("preview4",input({...present,samplerChoices:[]})).ok).toBe(false);
  });
  test("无加速 8+4 与试镜 6+2", () => {
    const a=success("balanced84"), b=success("quick62");
    expect([a.firstPassSteps,a.secondPassSteps]).toEqual([8,4]);
    expect([b.firstPassSteps,b.secondPassSteps]).toEqual([6,2]);
    expect(b.primaryLora).toBe("custom/pika-v2-turbo_8steps_hd.safetensors");
    expect(b.extraLoras).toEqual([{name:"style/film.safetensors",strength:0.6}]);
  });
  test("旧项目普通主 LoRA 迁入附加槽，满3个则拒绝静默覆盖", () => {
    const patch={primaryLora:"legacy/old-style.safetensors",primaryStrength:0.5};
    const ok=success("quick62",patch);
    expect(ok.extraLoras[0]).toEqual({name:"legacy/old-style.safetensors",strength:0.5});
    const no=createH3PresetPlan("quick62",input({...patch,extraLoras:[
      {name:"style/a.safetensors",strength:1},{name:"style/b.safetensors",strength:1},{name:"style/c.safetensors",strength:1}]}));
    expect(no.ok).toBe(false);
  });
  test("未安装、冲突步数或多版本未选择时不可误用", () => {
    expect(createH3PresetPlan("quick62",input({installedLoras:["s/3step.safetensors"]})).ok).toBe(false);
    expect(createH3PresetPlan("quick62",input({installedLoras:["s/8step-v1.safetensors","s/8step-v2.safetensors"]})).ok).toBe(false);
    expect(success("quick62",{installedLoras:["s/8step-v1.safetensors","s/8step-v2.safetensors"],primaryLora:"s/8step-v2.safetensors"}).primaryLora).toBe("s/8step-v2.safetensors");
  });
  test("融合 Turbo 仅关闭加速 LoRA，保留普通 LoRA", () => {
    const result=success("fused8",{checkpointKind:"fused",extraLoras:[
      {name:"style/film.safetensors",strength:0.6},{name:"speed/8step.safetensors",strength:1}]});
    expect([result.firstPassSteps,result.secondPassSteps,result.sampler,result.primaryLora]).toEqual([6,2,"euler",""]);
    expect(result.extraLoras).toEqual([{name:"style/film.safetensors",strength:0.6}]);
    expect(createH3PresetPlan("fused8",input({checkpointKind:"fused",samplerChoices:[]})).ok).toBe(false);
    expect(createH3PresetPlan("normal",input({checkpointKind:"fused"})).ok).toBe(false);
  });
  test("手动标记的 LoRA 即使无 turbo/step 命名，也能被快速档识别", () => {
    const custom="experimental/special-pdd.safetensors";
    expect(isAccelerationLora(custom)).toBe(false);
    expect(isAccelerationLora(custom,[custom.replaceAll("/", "\\")])).toBe(true);
    const patch={ installedLoras:[custom], manualAccelerationLoras:[custom], primaryLora:custom };
    const four=createH3PresetPlan("preview4",input(patch));
    const eight=success("quick62",patch);
    expect(four.ok).toBe(false);
    expect([eight.firstPassSteps,eight.secondPassSteps]).toEqual([6,2]);
    expect(eight.primaryLora).toBe(custom);
    expect(eight.hint).toContain("专用节点或调度器");
  });
  test("普通25步与融合Turbo会移除手动标记的加速 LoRA，但保留真正的风格 LoRA", () => {
    const tagged="custom/acceleration.safetensors";
    const patch={ manualAccelerationLoras:[tagged],primaryLora:tagged,
      extraLoras:[{name:tagged,strength:1},{name:"style/film.safetensors",strength:0.6}]};
    const normal=success("normal",patch);
    expect(normal.primaryLora).toBe("");
    expect(normal.extraLoras).toEqual([{name:"style/film.safetensors",strength:0.6}]);
    const fused=success("fused8",{...patch,checkpointKind:"fused"});
    expect(fused.extraLoras).toEqual([{name:"style/film.safetensors",strength:0.6}]);
  });
  test("没有手动标记的旧节点保持原有行为；已声明的3step不能用于8步", () => {
    const unknown="s/unmarked.safetensors";
    expect(createH3PresetPlan("quick62",input({installedLoras:[unknown],primaryLora:unknown})).ok).toBe(false);
    expect(createH3PresetPlan("quick62",input({
      installedLoras:["s/3step.safetensors"],manualAccelerationLoras:["s/3step.safetensors"],primaryLora:"s/3step.safetensors"
    })).ok).toBe(false);
  });
  test("未知步数 Turbo 候选提示验证", () => {
    const result=success("quick62",{installedLoras:["misc/AnyTurbo.safetensors"],primaryLora:"misc/AnyTurbo.safetensors"});
    expect(result.hint).toContain("需要验证");
  });
});
