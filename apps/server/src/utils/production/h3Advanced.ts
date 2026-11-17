import { h3OptionsSchema, type H3Options, type H3AdvancedCapability } from "@toonflow/tools-scaffold/runtime";
import type { WorkflowBindings } from "@/utils/production/bindings";
import { fail } from "@/utils/production/config";
import { findH3Checkpoint } from "@/utils/production/h3Workflow";

type Node = { class_type?: string; inputs?: Record<string, unknown> };
const get = (graph: Record<string, unknown>, id: string) => graph[id] as Node | undefined;
const link = (value: unknown, id: string, slot = 0) => Array.isArray(value) && value.length === 2 && String(value[0]) === id && value[1] === slot;
const text = (value: unknown): value is string => typeof value === "string" && !!value;
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// 只识别已知 ERCA 二采拓扑，拒绝未确认兼容的自定义工作流。
export function h3AdvancedCapability(graph: Record<string, unknown>, bindings: WorkflowBindings): H3AdvancedCapability | undefined {
  const cp = findH3Checkpoint(graph, bindings);
  if (bindings.promptFormat !== "h3Ref2va" || bindings.optionalLoraNode !== "21" || bindings.firstPassOutputNode !== "126" || cp?.nodeId !== "20") return;
  const classes = { "21":"LoraLoaderModelOnly", "10":"KSamplerSelect", "119":"BasicScheduler", "117":"SplitSigmas",
    "156":"MiniMaxH3SigmaShift", "125":"ModelAttentionBackend", "129":"ModelPreviewOverrideKJ",
    "14":"BasicGuider", "7":"SamplerCustomAdvanced", "113":"MMH3UltimateUpscale", "149":"ComfyMathExpression" };
  if (Object.entries(classes).some(([id, cls]) => get(graph,id)?.class_type !== cls || !get(graph,id)?.inputs)) return;
  const lora = get(graph,"21")!.inputs!, shift = get(graph,"156")!.inputs!, sampler = get(graph,"10")!.inputs!, scheduler = get(graph,"119")!.inputs!;
  const split = get(graph,"117")!.inputs!, first = get(graph,"7")!.inputs!, second = get(graph,"113")!.inputs!;
  if (!link(lora.model,"125") || !link(get(graph,"125")!.inputs!.model,"20") || !link(shift.model,"21")
    || !link(get(graph,"129")!.inputs!.model,"156") || !link(get(graph,"14")!.inputs!.model,"129") || !link(first.guider,"14")
    || !link(second.model,"129") || !link(first.sampler,"10") || !link(second.sampler,"10")
    || !link(first.sigmas,"117",0) || !link(second.sigmas,"117",1) || !link(split.sigmas,"119")
    || !link(scheduler.model,"129") || !link(scheduler.steps,"149",1)) return;
  const consumers = Object.entries(graph).flatMap(([id,node]) => Object.entries((node as Node)?.inputs ?? {}).filter(([,v]) => link(v,"21")).map(([key]) => id+"."+key));
  if (consumers.length !== 1 || consumers[0] !== "156.model") return;
  if (!text(sampler.sampler_name) || !text(scheduler.scheduler) || !num(lora.strength_model) || !num(shift.shift_video) || !num(shift.shift_audio)) return;
  return { loraStrength:lora.strength_model, sampler:sampler.sampler_name, scheduler:scheduler.scheduler, videoShift:shift.shift_video, audioShift:shift.shift_audio, maxExtraLoras:3 };
}

export function applyH3Options(graph: Record<string, unknown>, bindings: WorkflowBindings, raw: H3Options, primaryName?: string) {
  const spec = h3AdvancedCapability(graph, bindings);
  if (!spec) fail("当前工作流不支持 H3 高级采样或多 LoRA，请选择兼容二采工作流");
  const options = h3OptionsSchema.parse(raw);
  const primary = get(graph,"21")!.inputs!;
  const shift = get(graph,"156")!.inputs!;
  const name = primaryName ?? String(primary.lora_name);
  if (options.loraStrength !== undefined && name === "") fail("主 LoRA 已关闭，不能同时指定其强度");
  if (name && options.extraLoras?.some(item => item.name.replaceAll("\\","/") === name.replaceAll("\\","/"))) fail("主 LoRA 与附加 LoRA 不得重复");
  if (options.loraStrength !== undefined) primary.strength_model = options.loraStrength;
  if (options.sampler !== undefined) get(graph,"10")!.inputs!.sampler_name = options.sampler;
  if (options.scheduler !== undefined) get(graph,"119")!.inputs!.scheduler = options.scheduler;
  if (options.videoShift !== undefined) shift.shift_video = options.videoShift;
  if (options.audioShift !== undefined) shift.shift_audio = options.audioShift;
  let upstream = "21";
  const lockedLoraNodes: string[] = [];
  for (const item of options.extraLoras ?? []) {
    let id = 10000;
    while (Object.hasOwn(graph,String(id))) id++;
    const key = String(id);
    graph[key] = { class_type:"LoraLoaderModelOnly", inputs:{ model:[upstream,0], lora_name:item.name, strength_model:item.strength } };
    lockedLoraNodes.push(key);
    upstream = key;
  }
  // 原节点旁路逻辑稍后处理 primaryName=""，也会重连第一条附加 LoRA。
  shift.model = [upstream,0];
  return lockedLoraNodes;
}

export function effectiveH3Options(graph: Record<string, unknown>, locked: string[]) {
  const primary = get(graph,"21")?.inputs;
  const nodes = [...(primary ? ["21"] : []), ...locked.filter(id => id !== "21")];
  const loras = nodes.map(id => get(graph,id)?.inputs).filter((inputs): inputs is Record<string,unknown> => !!inputs)
    .map(inputs => ({ name:String(inputs.lora_name), strength:Number(inputs.strength_model) }));
  if (new Set(loras.map(item => item.name.replaceAll("\\", "/"))).size !== loras.length) fail("LoRA 文件经远端路径对齐后重复，请明确选择不重复的权重");
  const options: H3Options = { ...(primary ? {loraStrength:Number(primary.strength_model)} : {}),
    extraLoras: primary ? loras.slice(1) : loras,
    sampler:String(get(graph,"10")!.inputs!.sampler_name), scheduler:String(get(graph,"119")!.inputs!.scheduler),
    videoShift:Number(get(graph,"156")!.inputs!.shift_video), audioShift:Number(get(graph,"156")!.inputs!.shift_audio) };
  return { h3Options:options, h3Checkpoint:String(get(graph,"20")!.inputs!.unet_name), h3Loras:loras };
}
