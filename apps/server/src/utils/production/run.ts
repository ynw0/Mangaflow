// 按所选工作流把提示词和参考绑进 ComfyUI API JSON，再提交并取回文件。
import { readFile } from "@toonflow/file";
import type { MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";
import { resolveComfyBaseUrl } from "@/utils/production/autodl";
import { downloadOutput, probeComfy, submitWorkflow, uploadInput, waitForOutput } from "@/utils/production/comfyui";
import { fail, isWorkflowEnabled } from "@/utils/production/config";
import { findWorkflow, type WorkflowEntry } from "@/utils/production/catalog";
import { resolveWorkspacePath } from "@/utils/workspace/files";

type MediaRef = { path: string; mimeType?: string };

const ratioPixels: Record<string, [number, number]> = {
  "8:3": [2048, 768],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "1:1": [1024, 1024],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "3:2": [1248, 832],
  "2:3": [832, 1248],
  "21:9": [1568, 672],
};

// ComfyUI ResolutionSelector 的选项原文。
const videoAspect: Record<string, string> = {
  "1:1": "1:1 (Square)",
  "2:3": "2:3 (Portrait Photo)",
  "3:2": "3:2 (Photo)",
  "3:4": "3:4 (Portrait Standard)",
  "4:3": "4:3 (Standard)",
  "9:16": "9:16 (Portrait Widescreen)",
  "16:9": "16:9 (Widescreen)",
  "21:9": "21:9 (Ultrawide)",
};

// 直接采样的视频画幅，长边不超过 H3 的 1344。
const videoNative: Record<string, [number, number]> = {
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "1:1": [1024, 1024],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "3:2": [1248, 832],
  "2:3": [832, 1248],
  "21:9": [1344, 576],
};

// 全参参考在超分之后裁切的成片尺寸。
const videoDelivery: Record<string, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:3": [1440, 1080],
  "3:4": [1080, 1440],
  "3:2": [1620, 1080],
  "2:3": [1080, 1620],
  "21:9": [2520, 1080],
};

function pair(table: Record<string, [number, number]>, ratio?: string) {
  const hit = table[ratio?.trim() ?? ""];
  return hit ? { width: hit[0], height: hit[1] } : {};
}

function pixels(size?: string, ratio?: string) {
  const pair = /^(\d{2,5})x(\d{2,5})$/i.exec(size ?? "");
  if (pair) return { width: Number(pair[1]), height: Number(pair[2]) };
  const hit = ratioPixels[ratio ?? ""] ?? [1344, 768];
  return { width: hit[0], height: hit[1] };
}

function readPath(source: unknown, path: string) {
  const parts = path.split(".");
  let current = source;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function writePath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let current: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) fail(`绑定目标不存在: ${path}`);
    current = next as Record<string, unknown>;
  }
  const leaf = parts.at(-1);
  if (!leaf || !Object.hasOwn(current, leaf)) fail(`绑定目标不存在: ${path}`);
  current[leaf] = value;
}

function nodeInputs(workflow: Record<string, unknown>, target: string) {
  const parts = target.split(".");
  const nodeId = parts[0] ?? "";
  const node = workflow[nodeId];
  const inputs = node && typeof node === "object" && !Array.isArray(node)
    ? (node as { inputs?: Record<string, unknown> }).inputs
    : undefined;
  const field = parts[1] === "inputs" ? parts.slice(2).join(".") : "";
  return { nodeId, field, inputs };
}

function linksTo(value: unknown, nodeId: string): boolean {
  if (Array.isArray(value)) return String(value[0]) === nodeId || value.some(item => linksTo(item, nodeId));
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(item => linksTo(item, nodeId));
}

function hasConsumer(workflow: Record<string, unknown>, nodeId: string) {
  return Object.entries(workflow).some(([id, node]) => id !== nodeId && linksTo(node, nodeId));
}

function removeLinks(value: unknown, nodeId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (Array.isArray(item) && String(item[0]) === nodeId) delete record[key];
    else removeLinks(item, nodeId);
  }
}

// 可选输入没传时：目标已是连线就保持原样；没有任何下游的节点是输出，不能删。
function dropNode(workflow: Record<string, unknown>, target: string, source: string) {
  const { nodeId, field, inputs } = nodeInputs(workflow, target);
  if (!nodeId || !Object.hasOwn(workflow, nodeId)) return;
  if (field && Array.isArray(inputs?.[field])) return;
  if (!hasConsumer(workflow, nodeId)) fail(`可选输入 ${source} 的目标 ${nodeId} 是输出节点，不能删除`);
  delete workflow[nodeId];
  for (const node of Object.values(workflow)) removeLinks(node, nodeId);
}

function terminalNodeIds(workflow: Record<string, unknown>) {
  return Object.keys(workflow).filter(nodeId => !hasConsumer(workflow, nodeId));
}

async function localFile(directory: string, ref?: MediaRef) {
  if (!ref?.path) return;
  const resolved = await resolveWorkspacePath(directory, ref.path);
  return resolved.path;
}

async function renderWorkflow(entry: WorkflowEntry, context: Record<string, unknown>, baseUrl: string, signal?: AbortSignal) {
  const raw = JSON.parse(await readFile(entry.workflowPath, "utf8")) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`工作流不是 API JSON: ${entry.id}`);
  const workflow = structuredClone(raw) as Record<string, unknown>;
  const dropped: string[] = [];
  for (const binding of entry.bindings.bindings) {
    const value = readPath(context, binding.source);
    const missing = value == null || (binding.kind !== "value" && value === "");
    if (missing) {
      if (binding.required) fail(`工作流 ${entry.label} 缺少 ${binding.source}`);
      if (binding.kind !== "value") {
        const nodeId = binding.target.split(".")[0] ?? "";
        const existed = Object.hasOwn(workflow, nodeId);
        dropNode(workflow, binding.target, binding.source);
        if (existed && !Object.hasOwn(workflow, nodeId)) dropped.push(`${binding.source} 删除了节点 ${nodeId}`);
      }
      continue;
    }
    const { inputs, field } = nodeInputs(workflow, binding.target);
    if (binding.kind !== "value" && field && Array.isArray(inputs?.[field])) {
      fail(`绑定 ${binding.source} 的目标 ${binding.target} 是连线，不能写入文件名`);
    }
    const next = binding.kind === "value"
      ? value
      : await uploadInput(baseUrl, String(value), "toonflow", signal);
    writePath(workflow, binding.target, next);
  }
  const outputs = terminalNodeIds(workflow);
  if (!outputs.length) fail(dropped.length ? `工作流 ${entry.label} 没有输出节点。${dropped.join("；")}` : `工作流 ${entry.label} 没有输出节点`);
  return workflow;
}

export async function runComfyWorkflow(options: {
  directory: string;
  mediaType: "image" | "video";
  request: MediaGenerationRequest;
  signal?: AbortSignal;
}) {
  const { directory, mediaType, request, signal } = options;
  const entry = await findWorkflow(request.modelId);
  if (!isWorkflowEnabled(entry.id)) fail(`${entry.label} 已在设置中关闭`);
  if (entry.kind !== mediaType) fail(`${entry.label} 不是${mediaType === "image" ? "出图" : "出视频"}工作流`);
  const limits = entry.bindings.capabilities.durationSeconds;
  if (mediaType === "video" && limits && request.duration != null && (request.duration < limits.min || request.duration > limits.max)) {
    fail(`${entry.label} 的时长需要在 ${limits.min} 到 ${limits.max} 秒`);
  }
  const baseUrl = await resolveComfyBaseUrl(signal);
  await probeComfy(baseUrl, signal);

  const images = request.images ?? [];
  const referenceSlots = entry.bindings.bindings.filter(item => /^refs\.slot\d+$/.test(item.source)).length;
  if (images.length > referenceSlots) fail(`参考图片数量超过参考槽：传入 ${images.length} 张，${entry.label} 只有 ${referenceSlots} 个参考槽`);
  const refs: Record<string, string | undefined> = {};
  for (let index = 0; index < images.length; index += 1) refs[`slot${index + 1}`] = await localFile(directory, images[index]);
  refs.first_frame = await localFile(directory, request.firstFrame) ?? refs.slot1;
  refs.last_frame = await localFile(directory, request.lastFrame) ?? (images.length > 1 ? await localFile(directory, images[1]) : undefined);
  const ratio = request.ratio?.trim() ?? "";
  const bound = new Set(entry.bindings.bindings.map(item => item.source));
  // 用户没指定采样时：一采 8 步、二采 4 步、百万像素 0.2、放大 2。工作流没绑的项不写。
  const sampling = (source: string, given: number | undefined, fallback: number) => bound.has(source) ? given ?? fallback : undefined;
  const context = {
    prompt: request.prompt,
    image_prompt: request.prompt,
    negative_prompt: "",
    // 画布传入则用；未传保持旧行为随机
    seed: request.seed ?? crypto.getRandomValues(new Uint32Array(1))[0],
    duration: request.duration,
    aspect_ratio: videoAspect[ratio],
    megapixels: sampling("megapixels", request.megapixels, 0.2),
    upscale: sampling("upscale", request.upscale, 2),
    first_pass_steps: sampling("first_pass_steps", request.firstPassSteps, 8),
    second_pass_steps: sampling("second_pass_steps", request.secondPassSteps, 4),
    params: mediaType === "video" ? pair(videoNative, ratio) : pixels(request.size, request.ratio),
    delivery: pair(videoDelivery, ratio),
    refs,
    media: {
      video1: await localFile(directory, request.videos?.[0]),
      audio1: await localFile(directory, request.audios?.[0]),
      audio2: await localFile(directory, request.audios?.[1]),
      audio3: await localFile(directory, request.audios?.[2]),
    },
  };
  const workflow = await renderWorkflow(entry, context, baseUrl, signal);
  const promptId = await submitWorkflow(baseUrl, workflow, signal);
  const outputs = await waitForOutput(baseUrl, promptId, mediaType, signal);
  const files = [];
  for (const output of outputs) files.push(await downloadOutput(baseUrl, output, signal));
  return files;
}
