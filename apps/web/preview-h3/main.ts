import { createApp, h, reactive } from "vue";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./preview.css";
import GenerationSettings from "../../../packages/nodes/videoGenerationNode/src/components/generationSettings.vue";
document.documentElement.classList.add("dark");
const loras = ["pika_h3_flex_turbo_8step_hd_ref2va.safetensors","demo_motion_detail_long_model_name_for_layout_validation.safetensors","demo_cinematic_lighting_reference_adapter.safetensors","demo_extra_lora.safetensors"];
const state = reactive<Record<string, any>>({duration:5,resolution:"",megapixels:0.2,upscale:2,firstPassSteps:6,secondPassSteps:2,outputFirstPass:false,loraName:loras[0],h3Options:{extraLoras:[{name:loras[1],strength:0.8},{name:loras[2],strength:0.9}]},ratio:"16:9",mode:JSON.stringify("singleImage"),generateAudio:true,seed:12345,seedMode:"fixed",qcOverride:{mode:"custom"}});
const model = {mode:["singleImage"],durationResolutionMap:[{duration:[5,10,15],resolution:[]}],sampling:{megapixels:[0.2,0.4,0.8],multiple:32,upscaleMin:1,upscaleMax:4,upscaleStep:0.1,firstPassMin:1,firstPassMax:64,secondPassMin:1,secondPassMax:64,firstPassDefault:8,secondPassDefault:4},lora:{defaultName:loras[0]},checkpoint:{defaultName:"demo_h3_ref2va_checkpoint.safetensors"},h3Advanced:{loraStrength:1,maxExtraLoras:3,sampler:"res_multistep",scheduler:"simple",videoShift:12,audioShift:5},supportsFirstPassOutput:true,audio:"optional",supportsSeed:true};
createApp({setup(){return ()=>h("main",[
 h("header",[h("strong","MangaFlow · H3 视频生成设置"),h("p","真实 Vue 组件编译预览 · 测试模型数据（不连接 ComfyUI）")]),
 h("div",{class:"node"},[h(GenerationSettings as any,{...state,model,ratios:["16:9","9:16","1:1","4:3","3:4"],loraChoices:loras,checkpointChoices:["demo_h3_ref2va_checkpoint.safetensors","demo_h3_turbo_checkpoint.safetensors"],samplerChoices:["res_multistep","euler"],schedulerChoices:["simple","normal"],qcChoices:[{id:"qc/demo",label:"示例 Gemma QC",video:true,audio:true}],qcDefaults:{qcMethod:"model",qcLevel:"videoAudio",qcTrigger:"auto",videoQcModelId:"qc/demo",audioQcModelId:"qc/demo",gemmaQcHost:"local"},...Object.fromEntries(Object.keys(state).map(key=>["onUpdate:"+key,(value:unknown)=>state[key]=value]))})])
]);}}).mount("#app");
