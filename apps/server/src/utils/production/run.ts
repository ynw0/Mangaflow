// 按所选工作流把提示词和参考绑进 ComfyUI API JSON，再提交并取回文件。
import { readFile } from "@toonflow/file";
import type { MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";
import { resolveComfyBaseUrl } from "@/utils/production/autodl";
import { downloadOutput, probeComfy, submitWorkflow, uploadInput, waitForOutput } from "@/utils/production/comfyui";
import { fail } from "@/utils/production/config";
import { findWorkflow, type WorkflowEntry } from "@/utils/production/catalog";
import { resolveWorkspacePath } from "@/utils/workspace/files";

type MediaRef = { path: string; mimeType?: string };

const ratioPixels: Record<string, [number, number]> = {
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "1:1": [1024, 1024],
  "3:4": [768, 1024],
  "4:3": [1024, 768],
};

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

function dropNode(workflow: Record<string, unknown>, target: string) {
  const nodeId = target.split(".")[0] ?? "";
  delete workflow[nodeId];
  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== "object") continue;
    const inputs = (node as { inputs?: Record<string, unknown> }).inputs;
    if (!inputs) continue;
    for (const [key, value] of Object.entries(inputs)) {
      if (Array.isArray(value) && String(value[0]) === nodeId) delete inputs[key];
    }
  }
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
  for (const binding of entry.bindings.bindings) {
    const value = readPath(context, binding.source);
    const missing = value == null || (binding.kind !== "value" && value === "");
    if (missing) {
      if (binding.required) fail(`工作流 ${entry.label} 缺少 ${binding.source}`);
      if (binding.kind !== "value") dropNode(workflow, binding.target);
      continue;
    }
    const next = binding.kind === "value"
      ? value
      : await uploadInput(baseUrl, String(value), "toonflow", signal);
    writePath(workflow, binding.target, next);
  }
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
  if (entry.kind !== mediaType) fail(`${entry.label} 不是${mediaType === "image" ? "出图" : "出视频"}工作流`);
  const limits = entry.bindings.capabilities.durationSeconds;
  if (mediaType === "video" && limits && request.duration != null && (request.duration < limits.min || request.duration > limits.max)) {
    fail(`${entry.label} 的时长需要在 ${limits.min} 到 ${limits.max} 秒`);
  }
  const baseUrl = await resolveComfyBaseUrl(signal);
  await probeComfy(baseUrl, signal);

  const images = request.images ?? [];
  const refs: Record<string, string | undefined> = {};
  for (let index = 0; index < images.length && index < 9; index += 1) refs[`slot${index + 1}`] = await localFile(directory, images[index]);
  refs.first_frame = await localFile(directory, request.firstFrame) ?? refs.slot1;
  refs.last_frame = await localFile(directory, request.lastFrame) ?? (images.length > 1 ? await localFile(directory, images[1]) : undefined);
  const size = pixels(request.size, request.ratio);
  const context = {
    prompt: request.prompt,
    image_prompt: request.prompt,
    negative_prompt: "",
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    duration: request.duration,
    params: size,
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
  const output = await waitForOutput(baseUrl, promptId, mediaType, signal);
  return downloadOutput(baseUrl, output, signal);
}
