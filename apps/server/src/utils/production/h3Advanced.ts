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
  if (options.secondPassDenoise !== undefined && options.samplingMode !== "independent") fail("二采降噪强度仅适用于独立双采");
  if (options.samplingMode !== "independent" && (options.secondPassLoras !== undefined || options.secondPassSampler !== undefined || options.secondPassScheduler !== undefined)) fail("二采独立 LoRA、采样器和调度器仅适用于独立双采");
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
  if (options.samplingMode === "independent") applyIndependentSampling(graph, options.secondPassDenoise ?? 0.25);
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
  if (options.samplingMode === "independent") configureSecondPass(graph, options, lockedLoraNodes);
  return lockedLoraNodes;
}

// 复用原有模型、采样器、超分与音视频输出，只替换两个阶段的 Sigma 序列。
function applyIndependentSampling(graph: Record<string, unknown>, denoise: number) {
  const first = get(graph,"7")!.inputs!, second = get(graph,"113")!.inputs!;
  const scheduler = get(graph,"119")!.inputs!, sum = get(graph,"149")!.inputs!, split = get(graph,"117")!.inputs!;
  if (!link(sum["values.a"],"150") || !link(sum["values.b"],"148") || sum.expression !== "a + b"
    || !link(split.step,"150") || get(graph,"150")?.class_type !== "INTConstant"
    || get(graph,"148")?.class_type !== "INTConstant") fail("独立双采需要已知的一二采步数绑定");
  const consumers = (id: string) => Object.entries(graph).flatMap(([key,node]) =>
    Object.entries((node as Node)?.inputs ?? {}).filter(([,v]) => Array.isArray(v) && v.length === 2 && String(v[0]) === id)
      .map(([field]) => key+"."+field)).sort().join(",");
  if (consumers("117") !== "113.sigmas,7.sigmas" || consumers("149") !== "119.steps") fail("采样序列还有其他连接，不能安全切换独立双采");
  let id = 162;
  while (Object.hasOwn(graph,String(id))) id++;
  const secondId = String(id);
  graph[secondId] = { class_type:"BasicScheduler", inputs:{...scheduler, steps:["148",0], denoise} };
  scheduler.steps = ["150",0];
  scheduler.denoise = 1;
  first.sigmas = ["119",0];
  second.sigmas = [secondId,0];
  delete graph["117"];
  delete graph["149"];
}

// 二采单独配置时从原始 Attention 模型开始，不继承一采的 LoRA。
function configureSecondPass(graph: Record<string, unknown>, options: H3Options, locked: string[]) {
  const second = get(graph,"113")!.inputs!;
  const sigmaLink = second.sigmas as [string,number];
  const scheduler = get(graph,String(sigmaLink[0]))!.inputs!;
  function add(class_type:string, inputs:Record<string,unknown>) {
    let id=10000;
    while (Object.hasOwn(graph,String(id))) id++;
    const key=String(id);
    graph[key]={class_type,inputs};
    return key;
  }
  if (options.secondPassLoras !== undefined) {
    let upstream="125";
    for (const item of options.secondPassLoras) {
      upstream=add("LoraLoaderModelOnly",{model:[upstream,0],lora_name:item.name,strength_model:item.strength});
      locked.push(upstream);
    }
    const shift=add("MiniMaxH3SigmaShift",{...get(graph,"156")!.inputs!,model:[upstream,0]});
    const preview=add("ModelPreviewOverrideKJ",{...get(graph,"129")!.inputs!,model:[shift,0]});
    second.model=[preview,0];
    scheduler.model=[preview,0];
  }
  if (options.secondPassSampler !== undefined) {
    second.sampler=[add("KSamplerSelect",{sampler_name:options.secondPassSampler}),0];
  }
  if (options.secondPassScheduler !== undefined) scheduler.scheduler=options.secondPassScheduler;
}

// 根据实际连接识别二采 LoRA，避免把独立二采 LoRA 记录到一采附加列表。
function separateSecondLoraIds(graph: Record<string,unknown>) {
  const model=get(graph,"113")!.inputs!.model;
  if (link(model,"129")) return undefined;
  const source=(value:unknown)=>Array.isArray(value)?String(value[0]):"";
  const preview=get(graph,source(model));
  const shift=get(graph,source(preview?.inputs?.model));
  let id=source(shift?.inputs?.model);
  const ids:string[]=[];
  while (get(graph,id)?.class_type==="LoraLoaderModelOnly") {
    if (ids.includes(id)) fail("二采 LoRA 链路存在循环");
    ids.unshift(id);
    id=source(get(graph,id)?.inputs?.model);
  }
  if (id!=="125") fail("二采 LoRA 链路未连接原始模型");
  return ids;
}

export function effectiveH3Options(graph: Record<string, unknown>, locked: string[]) {
  const primary = get(graph,"21")?.inputs;
  const secondIds = separateSecondLoraIds(graph);
  const nodes = [...(primary ? ["21"] : []), ...locked.filter(id => id !== "21" && !secondIds?.includes(id))];
  const readLoras=(ids:string[])=>ids.map(id => get(graph,id)?.inputs).filter((inputs): inputs is Record<string,unknown> => !!inputs)
    .map(inputs => ({ name:String(inputs.lora_name), strength:Number(inputs.strength_model) }));
  const loras=readLoras(nodes);
  const secondLoras=secondIds===undefined?undefined:readLoras(secondIds);
  if (secondLoras && new Set(secondLoras.map(item=>item.name.replaceAll("\\","/"))).size!==secondLoras.length) fail("二采 LoRA 文件重复");
  if (new Set(loras.map(item => item.name.replaceAll("\\", "/"))).size !== loras.length) fail("LoRA 文件经远端路径对齐后重复，请明确选择不重复的权重");
  const independent = link(get(graph,"7")!.inputs!.sigmas,"119");
  const secondSigmas = get(graph,"113")!.inputs!.sigmas;
  const secondScheduler = independent && Array.isArray(secondSigmas) ? get(graph,String(secondSigmas[0]))?.inputs : undefined;
  const options: H3Options = { samplingMode: independent ? "independent" : "split",
    ...(secondScheduler ? {secondPassDenoise:Number(secondScheduler.denoise)} : {}),
    ...(secondLoras === undefined ? {} : {secondPassLoras:secondLoras}),
    ...(!link(get(graph,"113")!.inputs!.sampler,"10") ? {secondPassSampler:String(get(graph,String((get(graph,"113")!.inputs!.sampler as [string,number])[0]))!.inputs!.sampler_name)} : {}),
    ...(secondScheduler && secondScheduler.scheduler !== get(graph,"119")!.inputs!.scheduler ? {secondPassScheduler:String(secondScheduler.scheduler)} : {}),
    ...(primary ? {loraStrength:Number(primary.strength_model)} : {}),
    extraLoras: primary ? loras.slice(1) : loras,
    sampler:String(get(graph,"10")!.inputs!.sampler_name), scheduler:String(get(graph,"119")!.inputs!.scheduler),
    videoShift:Number(get(graph,"156")!.inputs!.shift_video), audioShift:Number(get(graph,"156")!.inputs!.shift_audio) };
  return { h3Options:options, h3Checkpoint:String(get(graph,"20")!.inputs!.unet_name), h3Loras:loras };
}
