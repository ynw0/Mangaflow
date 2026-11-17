import { describe, expect, test } from "bun:test";
import { h3SamplingStrategyInput, planH3Sampling, preferred4StepLora } from "./h3SamplingStrategy";

const get = (patch: Record<string, unknown> = {}) => h3SamplingStrategyInput.parse({
  phase:"preview",checkpointName:"MiniMax-H3-Ref2VA.safetensors",checkpointKind:"standard",
  isRef2vaWorkflow:true,
  loraChoices:["minimax/"+preferred4StepLora,"other/minimax_h3_ref2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors","style/cinema.safetensors"],
  selectedLora:"",samplerChoices:["euler","res_multistep"],schedulerChoices:["simple"],
  compatibilityConfirmed:false,extraLoras:[{name:"style/cinema.safetensors",strength:0.8}],...patch,
});
const plan = (patch: Record<string, unknown> = {}) => planH3Sampling(get(patch));
describe("H3 智能采样策略",()=>{
  test("4步仅选用户指定的 LightX2V Ref2VA 文件名及2+2",()=>{
    const p=plan();expect(p.status).toBe("experimental");
    expect(p.setConfig?.loraName).toContain(preferred4StepLora);
    expect([p.setConfig?.firstPassSteps,p.setConfig?.secondPassSteps,p.totalSteps]).toEqual([2,2,4]);
    expect(p.setConfig?.h3Options.extraLoras).toEqual([{name:"style/cinema.safetensors",strength:0.8}]);
  });
  test("不把 TaoMate 3step 自动当成 Ref2VA 4step",()=>{
    const p=plan({loraChoices:["TaoMate-H3-3step.safetensors"]});
    expect(p.status).toBe("blocked");
  });
  test("自动正式镜头无兼容证明时回退25步，不滥用4步成片",()=>{
    const p=plan({phase:"normal"});expect(p.preset).toBe("quality");
    expect(p.totalSteps).toBe(25);
    expect(p.setConfig?.loraName).toBe("");
  });
  test("经兼容验证的8步4+4、6+2",()=>{
    const a=plan({phase:"normal",compatibilityConfirmed:true});
    const b=plan({phase:"motion",compatibilityConfirmed:true});
    expect([a.preset,a.setConfig?.firstPassSteps,a.setConfig?.secondPassSteps]).toEqual(["quick44",4,4]);
    expect([b.preset,b.setConfig?.firstPassSteps,b.setConfig?.secondPassSteps]).toEqual(["quick62",6,2]);
    expect(a.setConfig?.h3Options.sampler).toBe("euler");
  });
  test("25-40最大上限，保留普通风格LoRA，移除加速LoRA",()=>{
    const p=plan({intent:"quality",phase:"final",qualitySteps:40,selectedLora:"minimax/"+preferred4StepLora,
      extraLoras:[{name:"style/cinema.safetensors",strength:0.8},{name:"xxx_8step.safetensors",strength:1}]});
    expect([p.totalSteps,p.setConfig?.firstPassSteps,p.setConfig?.secondPassSteps]).toEqual([40,32,8]);
    expect(p.setConfig?.h3Options.extraLoras).toEqual([{name:"style/cinema.safetensors",strength:0.8}]);
    expect(h3SamplingStrategyInput.safeParse({...get(),qualitySteps:41}).success).toBe(false);
  });
  test("原主槽为风格LoRA时不丢失",()=>{
    const p=plan({intent:"quality",selectedLora:"style/cinema.safetensors",primaryStrength:0.55,extraLoras:[]});
    expect(p.setConfig?.h3Options.extraLoras).toEqual([{name:"style/cinema.safetensors",strength:0.55}]);
  });
  test("融合模型无兼容证明不准自行选择",()=>{
    expect(plan({intent:"fused8",checkpointKind:"standard"}).status).toBe("blocked");
    expect(plan({intent:"fused8",checkpointKind:"fused"}).status).toBe("blocked");
    const p=plan({intent:"fused8",checkpointKind:"fused",compatibilityConfirmed:true});
    expect([p.status,p.totalSteps,p.setConfig?.loraName]).toEqual(["ready",8,""]);
  });
  test("不支持双采的工作流直接拒绝",()=>{expect(plan({isRef2vaWorkflow:false}).status).toBe("blocked");});
  test("已选加速LoRA重复出现在普通风格中会过滤",()=>{
    const p=plan({intent:"quick44",phase:"normal",compatibilityConfirmed:true,
      extraLoras:[{name:"other/minimax_h3_ref2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors",strength:1}]});
    expect(p.setConfig?.h3Options.extraLoras).toHaveLength(0);
  });
});
