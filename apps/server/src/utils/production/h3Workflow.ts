import type { WorkflowBindings } from "@/utils/production/bindings";
import { fail } from "@/utils/production/config";

// 这些视频输出节点的音频插口可选，与参考音频输入互不影响。
export function videoAudioInputs(nodes: Record<string, unknown>) {
  return Object.values(nodes).flatMap(node => {
    const candidate = node as { class_type?: string; inputs?: Record<string, unknown> } | null;
    if ((candidate?.class_type === "CreateVideo" || candidate?.class_type === "VHS_VideoCombine")
      && Array.isArray(candidate.inputs?.audio)) return [candidate.inputs];
    return [];
  });
}

export function validateH3Workflow(nodes: unknown, bindings: WorkflowBindings) {
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) fail("工作流必须是 API JSON 对象");
  const classes = Object.values(nodes).flatMap(node => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    const record = node as { class_type?: unknown; inputs?: Record<string, unknown> };
    const name = typeof record.class_type === "string" ? record.class_type : "";
    const h3Model = Object.entries(record.inputs ?? {}).some(([key, value]) =>
      /^(?:unet_name|model_name|clip_name|vae_name|lora_name|ckpt_name)$/.test(key)
      && typeof value === "string" && /minimax[_ -]?h3|(?:^|[\\/])h3[\\/]/i.test(value));
    return /minimax[_ -]?h3|mmh3/i.test(name) || h3Model ? [name] : [];
  });
  if (!classes.length) return;
  if (!bindings.promptFormat) fail("检测到 H3 节点或模型，必须声明 prompt_format: h3Ref2va 或 h3Frames");
  const frames = bindings.bindings.some(binding => binding.source === "refs.first_frame" || binding.source === "refs.last_frame");
  const imageNode = classes.some(name => /^MiniMaxH3ImageToVideo$/i.test(name));
  const referenceNode = classes.some(name => /^MiniMaxH3ReferenceToVideo$/i.test(name));
  if (imageNode && referenceNode) fail("同一工作流包含不同 H3 提示词模式，请拆分为独立工作流");
  if (referenceNode && frames) fail("H3 ReferenceToVideo 节点不能声明首尾帧提示词模式，请核对参考绑定");
  const expected = imageNode || frames ? "h3Frames" : "h3Ref2va";
  if (bindings.promptFormat !== expected) fail(`H3 节点及参考绑定与 prompt_format 不一致，应声明 ${expected}`);
  if (bindings.firstPassOutputNode) {
    const id = bindings.firstPassOutputNode;
    const candidate = (nodes as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>)[id];
    if (candidate?.class_type !== "VHS_VideoCombine" || !Array.isArray(candidate.inputs?.images)) {
      fail(`一采保存节点 ${id} 必须是已连接一采图像的 VHS_VideoCombine`);
    }
    if (candidate.inputs.save_output !== true) fail(`一采保存节点 ${id} 必须配置 save_output=true`);
  }
  if (bindings.optionalLoraNode) {
    const id = bindings.optionalLoraNode;
    const candidate = (nodes as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>)[id];
    if (candidate?.class_type !== "LoraLoaderModelOnly"
      || !Array.isArray(candidate.inputs?.model)
      || typeof candidate.inputs?.lora_name !== "string"
      || typeof candidate.inputs?.strength_model !== "number") {
      fail(`可选 LoRA 节点 ${id} 必须是带模型输入、文件名和强度的 LoraLoaderModelOnly`);
    }
  }
  if (!bindings.bindings.some(binding => binding.source === "prompt" && binding.kind === "value")) fail("H3 工作流必须绑定文本 prompt");
}
