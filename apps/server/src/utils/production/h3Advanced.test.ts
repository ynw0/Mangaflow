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
const names=["h3_ref2va_dual"];
const read=async (name:string) => ({
  graph:await Bun.file(join(root,name+"_api.json")).json() as Record<string,any>,
  bindings:parseWorkflowBindings(await Bun.file(join(root,name+".bindings.yaml")).text()),
});
describe("H3 双采高级参数",()=>{
  test("统一工作流无参考图、参考视频/音频可选，未选主模型时不可提交",async()=>{
    const {graph,bindings}=await read(names[0]!);
    expect([graph["150"].inputs.value,graph["148"].inputs.value]).toEqual([4,4]);
    expect([graph["156"].inputs.shift_video,graph["156"].inputs.shift_audio]).toEqual([12,3]);
    expect(graph["20"].inputs.unet_name).toBe("");
    expect(graph["21"].inputs.lora_name).toBe("");
    expect(graph["120"]).toBeUndefined();
    expect(bindings.bindings.filter(x=>x.kind==="image")).toHaveLength(9);
    expect(bindings.bindings.filter(x=>x.kind==="image" && x.required)).toHaveLength(0);
    expect(bindings.bindings.filter(x=>x.kind==="video")).toHaveLength(1);
    expect(bindings.bindings.filter(x=>x.kind==="audio")).toHaveLength(3);
    const dir=await realpath(await mkdtemp(join(tmpdir(),"manga-h3-unified-")));
    try{
      const base=videoGenerationSchema.parse({
        providerId:"comfyui",modelId:"video/h3_ref2va_dual",prompt:"test",duration:5,ratio:"9:16",
      });
      await expect(prepareComfyWorkflow({directory:dir,mediaType:"video",request:base})).rejects.toThrow("明确选择已安装的 H3 主模型");
      const prepared=await prepareComfyWorkflow({directory:dir,mediaType:"video",request:{
        ...base,checkpointName:"minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors",loraName:"",firstPassSteps:4,secondPassSteps:4,
      }});
      const output=prepared.workflow as Record<string,any>;
      expect(output["8"].inputs.aspect_ratio).toBe("9:16 (Portrait Widescreen)");
      expect(output["135"]).toBeUndefined();
      for(const id of ["24","15","123","130","132","133","159","160","161","27","41","134"])expect(output[id]).toBeUndefined();
      expect(output["6"].inputs["ref_videos.ref_video_0"]).toBeUndefined();
      expect(output["6"].inputs["ref_images.ref_image_0"]).toBeUndefined();
      expect(output["21"]).toBeUndefined();
      expect(output["120"]).toBeUndefined();
    } finally {await rm(dir,{recursive:true,force:true});}
  });

  test("统一双采支持 H3 高级参数且不破坏共享 Sigma",async()=>{
    for(const name of names){
      const { graph,bindings }=await read(name);
      // 工作流默认不带 LoRA；模拟用户在节点设置中明确选择后，再验证强度与链路。
      graph["21"].inputs.lora_name="compatible-8step.safetensors";
      const before=structuredClone(graph);
      expect(h3AdvancedCapability(graph,bindings)).toMatchObject({loraStrength:1,sampler:"res_multistep",scheduler:"simple",videoShift:12,audioShift:3});
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
    expect(()=>applyH3Options(graph,bindings,{extraLoras:[{name:"test.safetensors",strength:1}]},"test.safetensors")).toThrow("不得重复");
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
      const request=videoGenerationSchema.parse({providerId:"comfyui",modelId:"video/h3_ref2va_dual",checkpointName:"minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors",loraName:"",prompt:"test",duration:5,ratio:"16:9",images:[{path:"ref.png",mimeType:"image/png"}],seed:123,seedMode:"fixed"});
      const old=await prepareComfyWorkflow({directory:dir,mediaType:"video",request});
      const workflow=old.workflow as Record<string,any>;
      expect(workflow["21"]).toBeUndefined();
      expect(workflow["156"].inputs.shift_audio).toBe(3);
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
