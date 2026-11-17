import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { h3OptionsSchema } from "@toonflow/tools-scaffold/runtime";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { h3AdvancedCapability, applyH3Options } from "./h3Advanced";
import { parseWorkflowBindings } from "./bindings";
import { prepareComfyWorkflow } from "./run";
import { captureVideoReview, videoPromptReviewScope } from "./videoReviews";
const root=resolve(import.meta.dirname,"../../../../../workflows/video");
const names=["h3_erca_16x9","h3_erca_9x16","h3_erca_16x9_autodl","h3_erca_9x16_autodl"];
const read=async (name:string) => ({
  graph:await Bun.file(join(root,name+"_api.json")).json() as Record<string,any>,
  bindings:parseWorkflowBindings(await Bun.file(join(root,name+".bindings.yaml")).text()),
});
describe("H3 双采高级参数",()=>{
  test("四套原始工作流均明确支持；不修改原始默认值及采样共享关系",async()=>{
    for(const name of names){
      const { graph,bindings }=await read(name);
      const before=structuredClone(graph);
      expect(h3AdvancedCapability(graph,bindings)).toMatchObject({loraStrength:1,sampler:"res_multistep",scheduler:"simple",videoShift:12,audioShift:name==="h3_erca_16x9"?5:3});
      expect(graph).toEqual(before);
      const ids=applyH3Options(graph,bindings,{loraStrength:0.7,extraLoras:[{name:"combat.safetensors",strength:0.9},{name:"style.safetensors",strength:0.4}],sampler:"euler",scheduler:"beta",videoShift:10,audioShift:3});
      expect(ids).toHaveLength(2);
      expect(graph["21"].inputs.strength_model).toBe(0.7);
      expect(graph[ids[0]!].inputs).toEqual({model:["21",0],lora_name:"combat.safetensors",strength_model:0.9});
      expect(graph[ids[1]!].inputs.model).toEqual([ids[0],0]);
      expect(graph["156"].inputs).toMatchObject({model:[ids[1],0],shift_video:10,shift_audio:3});
      expect(graph["10"].inputs.sampler_name).toBe("euler");
      expect(graph["119"].inputs.scheduler).toBe("beta");
      for(const id of ["7","113","117","149","18","19","26","118","126"]) expect(graph[id]).toEqual(before[id]);
    }
  });
  test("未知拓扑或重复/非法 LoRA 不允许改图",async()=>{
    const {graph,bindings}=await read(names[0]!);
    expect(()=>applyH3Options(graph,bindings,{extraLoras:[{name:graph["21"].inputs.lora_name,strength:1}]})).toThrow("不得重复");
    expect(()=>applyH3Options(graph,bindings,{loraStrength:1},"")).toThrow("已关闭");
    expect(()=>h3OptionsSchema.parse({extraLoras:[{name:"a/b",strength:1},{name:"a\\b",strength:.8}]})).toThrow();
    expect(()=>h3OptionsSchema.parse({videoShift:NaN})).toThrow();
    expect(()=>h3OptionsSchema.parse({extraLoras:[{name:"bad",strength:0}]})).toThrow();
    graph["113"].inputs.sampler=["999",0];
    expect(h3AdvancedCapability(graph,bindings)).toBeUndefined();
    expect(()=>applyH3Options(graph,bindings,{sampler:"euler"})).toThrow("不支持");
  });
  test("真实 prepare：旧请求无新增节点；关闭主 LoRA 并附加时仍接到原模型；审核包含改图",async()=>{
    const dir=await realpath(await mkdtemp(join(tmpdir(),"manga-h3-advanced-")));
    try {
      await writeFile(join(dir,"ref.png"),new Uint8Array([137,80,78,71,13,10,26,10]));
      const request=videoGenerationSchema.parse({providerId:"comfyui",modelId:"video/h3_erca_16x9",prompt:"test",duration:5,ratio:"16:9",images:[{path:"ref.png",mimeType:"image/png"}],seed:123,seedMode:"fixed"});
      const old=await prepareComfyWorkflow({directory:dir,mediaType:"video",request});
      const workflow=old.workflow as Record<string,any>;
      expect(workflow["21"].inputs.strength_model).toBe(1);
      expect(workflow["156"].inputs.shift_audio).toBe(5);
      expect(workflow["149"].inputs.expression).toBe("a + b");
      expect(old.lockedLoraNodes).toEqual([]);
      const advanced=await prepareComfyWorkflow({directory:dir,mediaType:"video",request:{...request,loraName:"",firstPassSteps:6,secondPassSteps:2,h3Options:{extraLoras:[{name:"combat.safetensors",strength:.9}],audioShift:3}}});
      const output=advanced.workflow as Record<string,any>;
      expect(output["21"]).toBeUndefined();
      const extra=advanced.lockedLoraNodes[0]!;
      expect(output[extra].inputs.model).toEqual(["125",0]);
      expect(output["156"].inputs.model).toEqual([extra,0]);
      expect(output["150"].inputs.value).toBe(6);
      expect(output["148"].inputs.value).toBe(2);
      expect(output["7"].inputs.sigmas).toEqual(["117",0]);
      expect(output["113"].inputs.sigmas).toEqual(["117",1]);
      const a=videoPromptReviewScope(await captureVideoReview(dir,old));
      const b=videoPromptReviewScope(await captureVideoReview(dir,advanced));
      expect(a.workflow).not.toBe(b.workflow);
      expect(b.parameters.h3_options).toMatchObject({audioShift:3});
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
