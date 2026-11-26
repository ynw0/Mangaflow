import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { h3OptionsSchema } from "@toonflow/tools-scaffold/runtime";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { h3AdvancedCapability, applyH3Options, effectiveH3Options } from "./h3Advanced";
import { parseWorkflowBindings } from "./bindings";
import { prepareComfyWorkflow } from "./run";
const root=resolve(import.meta.dirname,"../../../../../workflows/video");
const names=["h3_ref2va_dual"];
const read=async (name:string) => ({
  graph:await Bun.file(join(root,name+"_api.json")).json() as Record<string,any>,
  bindings:parseWorkflowBindings(await Bun.file(join(root,name+".bindings.yaml")).text()),
});
describe("H3 双采高级参数",()=>{
  test("未指定加速 LoRA 自动旁路空加载器，附加 LoRA 正确重连",async()=>{
    const dir=await realpath(await mkdtemp(join(tmpdir(),"manga-h3-lora-")));
    try {
      const base=videoGenerationSchema.parse({providerId:"comfyui",modelId:"video/h3_ref2va_dual",
        checkpointName:"minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors",
        prompt:"test",duration:5,ratio:"16:9"});
      const implicit=(await prepareComfyWorkflow({directory:dir,mediaType:"video",request:base})).workflow as Record<string,any>;
      const explicit=(await prepareComfyWorkflow({directory:dir,mediaType:"video",request:{...base,loraName:""}})).workflow as Record<string,any>;
      expect(implicit["21"]).toBeUndefined();
      expect(explicit["21"]).toBeUndefined();
      expect(implicit["156"].inputs.model).toEqual(explicit["156"].inputs.model);
      const withExtra=(await prepareComfyWorkflow({directory:dir,mediaType:"video",request:{
        ...base,h3Options:{extraLoras:[{name:"style.safetensors",strength:0.8}]}
      }})).workflow as Record<string,any>;
      expect(withExtra["21"]).toBeUndefined();
      const extra=Object.entries(withExtra).find(([,n])=>(n as any)?.inputs?.lora_name==="style.safetensors");
      expect(extra).toBeDefined();
      expect((extra?.[1] as any).inputs.model).toEqual((await read(names[0]!)).graph["21"].inputs.model);
      expect(withExtra["156"].inputs.model).toEqual([extra?.[0],0]);
      const named=(await prepareComfyWorkflow({directory:dir,mediaType:"video",request:{
        ...base,loraName:"speed_8step.safetensors"
      }})).workflow as Record<string,any>;
      expect(named["21"].inputs.lora_name).toBe("speed_8step.safetensors");
    }finally{await rm(dir,{recursive:true,force:true});}
  });

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
  test("视频参考与三路参考音频都能由同一份图绑定；不强制图片",async()=>{
    const dir=await realpath(await mkdtemp(join(tmpdir(),"manga-h3-refs-")));
    try{
      for(const file of ["clip.mp4","voice1.mp3","voice2.mp3","voice3.mp3"])
        await writeFile(join(dir,file),new Uint8Array([1,2,3,4]));
      const request=videoGenerationSchema.parse({
        providerId:"comfyui",modelId:"video/h3_ref2va_dual",
        checkpointName:"minimax/DasiwaMinimaxH3_dasiwaHybridV2_int8.safetensors",
        loraName:"",prompt:"A cinematic reverse shot",duration:15,ratio:"16:9",
        videos:[{path:"clip.mp4",mimeType:"video/mp4"}],
        audios:["voice1.mp3","voice2.mp3","voice3.mp3"].map(path=>({path,mimeType:"audio/mpeg"})),
      });
      const prepared=await prepareComfyWorkflow({directory:dir,mediaType:"video",request});
      const graph=prepared.workflow as Record<string,any>;
      expect(String(graph["135"].inputs.video).endsWith("clip.mp4")).toBe(true);
      expect(graph["6"].inputs["ref_videos.ref_video_0"]).toEqual(["135",0]);
      expect(graph["6"].inputs["ref_video_audios.ref_video_audio_0"]).toEqual(["135",2]);
      for(const [slot,id] of ["27","41","134"].entries()){
        expect(String(graph[id].inputs.audio).endsWith("voice"+(slot+1)+".mp3")).toBe(true);
        expect(graph["6"].inputs["ref_audios.ref_audio_"+slot]).toEqual([id,0]);
      }
      expect(graph["24"]).toBeUndefined();
      expect(graph["21"]).toBeUndefined();
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  test("独立双采保留音视频链路及用户指定参数",async()=>{
    const {graph,bindings}=await read(names[0]!);
    const original=structuredClone(graph);
    graph["150"].inputs.value=32; graph["148"].inputs.value=10;
    applyH3Options(graph,bindings,{samplingMode:"independent",secondPassDenoise:0.25,scheduler:"beta",sampler:"euler"});
    expect(graph["7"].inputs.sigmas).toEqual(["119",0]);
    expect(graph["119"].inputs).toMatchObject({steps:["150",0],denoise:1,scheduler:"beta"});
    const secondId=graph["113"].inputs.sigmas[0];
    expect(graph[secondId].class_type).toBe("BasicScheduler");
    expect(graph[secondId].inputs).toMatchObject({steps:["148",0],denoise:0.25,scheduler:"beta",model:["129",0]});
    expect(graph["117"]).toBeUndefined(); expect(graph["149"]).toBeUndefined();
    expect(graph["10"].inputs.sampler_name).toBe("euler");
    for(const id of ["6","90","106","118","83","128","114","126","98"]) expect(graph[id]).toEqual(original[id]);
    expect(Object.values(graph).every((n:any)=>Object.values(n.inputs??{}).every(v=>!Array.isArray(v)||v.length!==2||Object.hasOwn(graph,String(v[0]))))).toBe(true);
  });
  test("完整32+10独立双采经请求绑定，关闭 LoRA 后仍正确",async()=>{
    const dir=await realpath(await mkdtemp(join(tmpdir(),"manga-h3-independent-")));
    try {
      const request=videoGenerationSchema.parse({providerId:"comfyui",modelId:"video/h3_ref2va_dual",checkpointName:"minimax/Singularity-H3.safetensors",loraName:"",prompt:"test",duration:5,ratio:"9:16",firstPassSteps:32,secondPassSteps:10,outputFirstPass:true,h3Options:{samplingMode:"independent",secondPassDenoise:0.25}});
      const {workflow}=await prepareComfyWorkflow({directory:dir,mediaType:"video",request});
      const graph=workflow as Record<string,any>;
      expect(graph["21"]).toBeUndefined();
      expect(graph["150"].inputs.value).toBe(32); expect(graph["148"].inputs.value).toBe(10);
      expect(graph["7"].inputs.sigmas).toEqual(["119",0]);
      expect(graph[graph["113"].inputs.sigmas[0]].inputs.denoise).toBe(0.25);
      expect(graph["114"].inputs.audio).toEqual(["83",0]);
      expect(graph["126"].inputs.audio).toEqual(["128",0]);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  test("二采默认沿用一采；关闭或自定义 LoRA 不修改一采，二采调度器与模型匹配",async()=>{
    for(const secondPassLoras of [undefined,[],[{name:"second.safetensors",strength:0.7},{name:"shared.safetensors",strength:0.4}]]){
      const {graph,bindings}=await read(names[0]!);
      graph["21"].inputs.lora_name="primary.safetensors";
      const options={samplingMode:"independent" as const,extraLoras:[{name:"shared.safetensors",strength:0.8}],secondPassLoras,
        secondPassSampler:"euler",secondPassScheduler:"beta"};
      const locked=applyH3Options(graph,bindings,options);
      expect(graph["14"].inputs.model).toEqual(["129",0]);
      expect(graph["156"].inputs.model).toEqual([locked[0],0]);
      expect(graph["10"].inputs.sampler_name).toBe("res_multistep");
      expect(graph["119"].inputs.scheduler).toBe("simple");
      const second=graph["113"].inputs, scheduler=graph[second.sigmas[0]].inputs;
      expect(graph[second.sampler[0]].inputs.sampler_name).toBe("euler");
      expect(scheduler.scheduler).toBe("beta");
      expect(scheduler.model).toEqual(second.model);
      if(secondPassLoras===undefined) expect(second.model).toEqual(["129",0]);
      else {
        expect(second.model).not.toEqual(["129",0]);
        const shift=graph[graph[second.model[0]].inputs.model[0]].inputs;
        let cursor=shift.model[0];
        for(const item of [...secondPassLoras].reverse()){
          expect(graph[cursor].inputs).toMatchObject({lora_name:item.name,strength_model:item.strength});
          expect(locked).toContain(cursor);
          cursor=graph[cursor].inputs.model[0];
        }
        expect(cursor).toBe("125");
      }
      const effective=effectiveH3Options(graph,locked);
      expect(effective.h3Loras).toEqual([{name:"primary.safetensors",strength:1},{name:"shared.safetensors",strength:0.8}]);
      expect(effective.h3Options.secondPassLoras).toEqual(secondPassLoras);
      expect(effective.h3Options.secondPassSampler).toBe("euler");
      expect(effective.h3Options.secondPassScheduler).toBe("beta");
    }
  });
  test("一采关闭 LoRA 时二采可独立启用，且保留原输出节点",async()=>{
    const dir=await realpath(await mkdtemp(join(tmpdir(),"manga-h3-second-lora-")));
    try {
      const request=videoGenerationSchema.parse({providerId:"comfyui",modelId:"video/h3_ref2va_dual",checkpointName:"minimax/Singularity-H3.safetensors",loraName:"",prompt:"test",duration:5,ratio:"16:9",firstPassSteps:32,secondPassSteps:10,outputFirstPass:true,h3Options:{samplingMode:"independent",secondPassLoras:[{name:"refine.safetensors",strength:0.8}]}});
      const {workflow,lockedLoraNodes}=await prepareComfyWorkflow({directory:dir,mediaType:"video",request});
      const graph=workflow as Record<string,any>;
      expect(graph["21"]).toBeUndefined();
      expect(graph["156"].inputs.model).toEqual(["125",0]);
      expect(lockedLoraNodes).toHaveLength(1);
      expect(graph[lockedLoraNodes[0]!].inputs.model).toEqual(["125",0]);
      expect(effectiveH3Options(graph,lockedLoraNodes).h3Options.secondPassLoras).toEqual(request.h3Options?.secondPassLoras);
      expect(graph["114"].inputs.audio).toEqual(["83",0]);
      expect(graph["126"].inputs.audio).toEqual(["128",0]);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  test("分段双采拒绝二采独立设置",async()=>{
    const {graph,bindings}=await read(names[0]!);
    const before=structuredClone(graph);
    for(const options of [{secondPassLoras:[]},{secondPassSampler:"euler"},{secondPassScheduler:"beta"}]){
      expect(()=>applyH3Options(graph,bindings,{samplingMode:"split",...options})).toThrow("仅适用于独立双采");
      expect(graph).toEqual(before);
    }
    expect(()=>h3OptionsSchema.parse({secondPassLoras:[{name:"a/b",strength:1},{name:"a/b",strength:.5}]})).toThrow();
  });
  test("分段模式不改原采样图，独立模式拒绝未知连接和非法降噪",async()=>{
    const {graph,bindings}=await read(names[0]!);
    const before=structuredClone(graph);
    applyH3Options(graph,bindings,{samplingMode:"split"});
    expect(graph).toEqual(before);
    expect(()=>applyH3Options(graph,bindings,{samplingMode:"split",secondPassDenoise:0.25})).toThrow("仅适用于独立双采");
    expect(()=>h3OptionsSchema.parse({samplingMode:"independent",secondPassDenoise:0})).toThrow();
    graph["999"]={class_type:"Custom",inputs:{sigmas:["117",0]}};
    expect(()=>applyH3Options(graph,bindings,{samplingMode:"independent"})).toThrow("其他连接");
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
  test("关闭主 LoRA 并附加时仍接到原模型，采样调整不改提示词与参考",async()=>{
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
      expect({
        prompt: old.context.prompt, duration: old.context.duration, params: old.context.params,
        refs: old.context.refs, media: old.context.media, generate_audio: old.context.generate_audio,
      }).toEqual({
        prompt: advanced.context.prompt, duration: advanced.context.duration, params: advanced.context.params,
        refs: advanced.context.refs, media: advanced.context.media, generate_audio: advanced.context.generate_audio,
      });
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
