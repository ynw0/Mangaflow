// 本地或 AutoDL 上的 ComfyUI：探测、上传参考、提交工作流、取回输出。
import { readFile } from "@toonflow/file";
import { basename } from "node:path";
import { fail } from "@/utils/production/config";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const videoExtensions = new Set([".mp4", ".webm", ".mov"]);

export type ComfyOutput = { filename: string; subfolder: string; type: string };

function rootOf(baseUrl: string) {
  const value = baseUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(value)) fail("ComfyUI 地址必须是 http 或 https");
  return value;
}

async function comfyFetch(baseUrl: string, path: string, init: RequestInit, signal?: AbortSignal) {
  const root = rootOf(baseUrl);
  const paths = path.startsWith("/api/") ? [path] : [path, `/api${path}`];
  let last = "ComfyUI 没有响应";
  for (const item of paths) {
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(`${root}${item}`, { ...init, signal });
    } catch (error) {
      last = error instanceof Error ? error.message : last;
      continue;
    }
    if (response.status === 404) {
      last = `${item} 不存在`;
      continue;
    }
    return response;
  }
  fail(`ComfyUI 请求失败 ${path}: ${last}`, 502);
}

export async function probeComfy(baseUrl: string, signal?: AbortSignal) {
  const response = await comfyFetch(baseUrl, "/system_stats", { method: "GET" }, signal ?? AbortSignal.timeout(5000));
  if (!response.ok) fail(`ComfyUI 未就绪：HTTP ${response.status}`, 502);
  return { ok: true as const, baseUrl: rootOf(baseUrl) };
}

export async function uploadInput(baseUrl: string, filePath: string, subfolder: string, signal?: AbortSignal, verifiedBytes?: Uint8Array<ArrayBuffer>) {
  const bytes = verifiedBytes ?? new Uint8Array(await readFile(filePath, { signal }));
  const form = new FormData();
  form.append("image", new Blob([bytes]), basename(filePath));
  form.append("type", "input");
  form.append("subfolder", subfolder);
  form.append("overwrite", "true");
  const response = await comfyFetch(baseUrl, "/upload/image", { method: "POST", body: form }, signal);
  if (!response.ok) fail(`上传参考失败：HTTP ${response.status}`, 502);
  const data = await response.json() as { name?: string; subfolder?: string };
  const name = data.name || basename(filePath);
  const remote = data.subfolder || subfolder;
  return remote ? `${remote}/${name}` : name;
}

// 新版 ReferenceMultiLatent 把分辨率收进动态组合，参考图从 image_1 改成 images.image0。
function alignReferenceInputs(workflow: Record<string, unknown>) {
  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== "object") continue;
    const record = node as { class_type?: string; inputs?: Record<string, unknown> };
    if (record.class_type !== "ReferenceMultiLatent" || !record.inputs) continue;
    const inputs = record.inputs;
    if (inputs["resolution.megapixels"] == null && typeof inputs.megapixels === "number") {
      inputs["resolution.megapixels"] = inputs.megapixels;
      delete inputs.megapixels;
    }
    for (const [key, value] of Object.entries(inputs)) {
      const slot = /^image_(\d+)$/.exec(key);
      if (!slot) continue;
      const next = `images.image${Number(slot[1]) - 1}`;
      if (inputs[next] == null) inputs[next] = value;
      delete inputs[key];
    }
  }
}

function comboOptions(spec: unknown) {
  if (!Array.isArray(spec) || !spec.length) return [];
  const listed = spec[0];
  if (Array.isArray(listed) && listed.every(item => typeof item === "string")) return listed as string[];
  const extra = spec[1];
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return [];
  const options = (extra as { options?: unknown }).options;
  return Array.isArray(options) && options.every(item => typeof item === "string") ? options as string[] : [];
}

function fileName(value: string) {
  const normalized = value.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

// 按 ComfyUI 当前列表改模型名：先对齐分隔符，目录不同但同名文件只有一个时再用那个。
async function alignModelNames(baseUrl: string, workflow: Record<string, unknown>, signal?: AbortSignal) {
  const classes = new Set<string>();
  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== "object") continue;
    const record = node as { class_type?: string; inputs?: Record<string, unknown> };
    if (!record.class_type || !record.inputs) continue;
    if (Object.values(record.inputs).some(value => typeof value === "string" && /[/\\]/.test(value))) classes.add(record.class_type);
  }
  const listed = new Map<string, { paths: Map<string, string>; files: Map<string, string[]> }>();
  await Promise.all([...classes].map(async classType => {
    let response: Response | undefined;
    try {
      response = await comfyFetch(baseUrl, `/object_info/${encodeURIComponent(classType)}`, { method: "GET" }, signal);
    } catch {
      return;
    }
    if (!response.ok) return;
    const data = await response.json().catch(() => undefined) as Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }> | undefined;
    const input = data?.[classType]?.input;
    if (!input) return;
    const paths = new Map<string, string>();
    const files = new Map<string, string[]>();
    for (const group of [input.required, input.optional]) {
      if (!group) continue;
      for (const spec of Object.values(group)) {
        for (const option of comboOptions(spec)) {
          paths.set(option.replaceAll("\\", "/"), option);
          const name = fileName(option);
          files.set(name, [...(files.get(name) ?? []), option]);
        }
      }
    }
    listed.set(classType, { paths, files });
  }));
  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== "object") continue;
    const record = node as { class_type?: string; inputs?: Record<string, unknown> };
    const names = record.class_type ? listed.get(record.class_type) : undefined;
    if (!names || !record.inputs) continue;
    for (const [key, value] of Object.entries(record.inputs)) {
      if (typeof value !== "string" || !/[/\\]/.test(value)) continue;
      const exact = names.paths.get(value.replaceAll("\\", "/"));
      if (exact) {
        if (exact !== value) record.inputs[key] = exact;
        continue;
      }
      const hits = names.files.get(fileName(value)) ?? [];
      if (hits.length === 1 && hits[0] !== value) record.inputs[key] = hits[0];
    }
  }
}

export async function readFreeVram(baseUrl: string, signal?: AbortSignal) {
  const response = await comfyFetch(baseUrl, "/system_stats", { method: "GET" }, signal);
  if (!response.ok) return;
  const data = await response.json() as { devices?: { type?: string; vram_free?: number; torch_vram_free?: number }[] };
  const gpu = (data.devices ?? []).find(item => item.type && item.type !== "cpu");
  if (!gpu) return 0;
  const free = gpu.vram_free ?? gpu.torch_vram_free;
  return typeof free === "number" && Number.isFinite(free) ? free : undefined;
}

// 置卸载标志。正在跑的 prompt 不会被打断，结束后 Comfy 才回收显存。
export async function freeComfyMemory(baseUrl: string) {
  try {
    await comfyFetch(baseUrl, "/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    }, AbortSignal.timeout(8000));
  } catch {
    return;
  }
}

export async function readNodeChoices(baseUrl: string, classType: string, inputName: string, signal?: AbortSignal) {
  const response = await comfyFetch(baseUrl, `/object_info/${encodeURIComponent(classType)}`, { method: "GET" }, signal);
  if (!response.ok) fail(`无法读取 ComfyUI 节点 ${classType}`, 502);
  const data = await response.json() as Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>;
  const input = data[classType]?.input;
  return [...comboOptions(input?.required?.[inputName]), ...comboOptions(input?.optional?.[inputName])];
}

export async function cancelPrompt(baseUrl: string, promptId: string) {
  const headers = { "Content-Type": "application/json" };
  await comfyFetch(baseUrl, "/queue", {
    method: "POST", headers, body: JSON.stringify({ delete: [promptId] }),
  }, AbortSignal.timeout(8000)).catch(() => undefined);
  await comfyFetch(baseUrl, "/interrupt", {
    method: "POST", headers, body: JSON.stringify({ prompt_id: promptId }),
  }, AbortSignal.timeout(8000)).catch(() => undefined);
}

function trackPrompt(baseUrl: string, promptId: string, signal?: AbortSignal) {
  if (!signal) return () => {};
  const cancel = () => { void cancelPrompt(baseUrl, promptId); };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  return () => signal.removeEventListener("abort", cancel);
}

function delay(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(undefined);
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function formatPromptError(data: { error?: { type?: unknown; message?: unknown; details?: unknown }; node_errors?: Record<string, unknown> } | undefined, status: number) {
  const error = data?.error;
  const parts: string[] = [];
  if (typeof error?.type === "string" && error.type) parts.push(error.type);
  if (typeof error?.message === "string" && error.message) parts.push(error.message);
  if (typeof error?.details === "string" && error.details) parts.push(error.details);
  else if (error?.details && typeof error.details === "object") parts.push(JSON.stringify(error.details).slice(0, 500));
  if (data?.node_errors && Object.keys(data.node_errors).length) parts.push(JSON.stringify(data.node_errors).slice(0, 500));
  return parts.join("：") || `提交工作流失败：HTTP ${status}`;
}

export async function submitWorkflow(baseUrl: string, workflow: Record<string, unknown>, signal?: AbortSignal) {
  alignReferenceInputs(workflow);
  await alignModelNames(baseUrl, workflow, signal);
  const response = await comfyFetch(baseUrl, "/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
  }, signal);
  const data = await response.json().catch(() => undefined) as {
    prompt_id?: string;
    error?: { type?: unknown; message?: unknown; details?: unknown };
    node_errors?: Record<string, unknown>;
  } | undefined;
  if (!response.ok) fail(formatPromptError(data, response.status), 502);
  if (data?.node_errors && Object.keys(data.node_errors).length) fail(`工作流节点报错：${JSON.stringify(data.node_errors).slice(0, 500)}`, 502);
  if (!data?.prompt_id) fail("ComfyUI 未返回 prompt_id", 502);
  return data.prompt_id;
}

function collectOutputs(value: unknown, extensions: Set<string>, found: ComfyOutput[], seen: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach(item => collectOutputs(item, extensions, found, seen));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.filename === "string") {
    const suffix = record.filename.slice(record.filename.lastIndexOf(".")).toLowerCase();
    const item = { filename: record.filename, subfolder: String(record.subfolder ?? ""), type: String(record.type ?? "output") };
    const key = `${item.filename}\n${item.subfolder}\n${item.type}`;
    if (extensions.has(suffix) && !seen.has(key)) {
      seen.add(key);
      found.push(item);
    }
  }
  Object.values(record).forEach(item => collectOutputs(item, extensions, found, seen));
}

export async function waitForOutput(baseUrl: string, promptId: string, kind: "image" | "video", signal?: AbortSignal) {
  // 本机 Comfy 视频含排队经常超过 10 分钟，轮询上限放到 60 分钟。
  const deadline = Date.now() + (kind === "video" ? 60 : 10) * 60_000;
  const extensions = kind === "video" ? videoExtensions : imageExtensions;
  const stop = trackPrompt(baseUrl, promptId, signal);
  try {
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const response = await comfyFetch(baseUrl, `/history/${promptId}`, { method: "GET" }, signal);
      if (response.ok) {
        const data = await response.json() as Record<string, { status?: { status_str?: string; messages?: unknown }; outputs?: unknown }>;
        const item = data?.[promptId];
        if (item) {
          if (item.status?.status_str === "error") fail(`ComfyUI 生成失败：${JSON.stringify(item.status.messages ?? item.status).slice(0, 500)}`, 502);
          const outputs: ComfyOutput[] = [];
          collectOutputs(item.outputs ?? {}, extensions, outputs, new Set());
          if (outputs.length) return outputs;
          if (item.status?.status_str === "success") fail("ComfyUI 完成但没有图片或视频输出", 502);
        }
      }
      await delay(2000, signal);
    }
  } finally {
    stop();
  }
  fail(kind === "video" ? "视频生成超时" : "出图超时", 504);
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map(item => flattenText(item)).filter(Boolean).join("\n").trim();
}

function textFromOutputs(outputs: unknown) {
  if (!outputs || typeof outputs !== "object") return "";
  const record = outputs as Record<string, unknown>;
  const chunks = record["3"] ? [record["3"], ...Object.values(record).filter(item => item !== record["3"])] : Object.values(record);
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue;
    const text = flattenText((chunk as { text?: unknown }).text);
    if (text) return text;
  }
  return "";
}

export async function waitForText(baseUrl: string, promptId: string, signal?: AbortSignal) {
  const deadline = Date.now() + 20 * 60_000;
  const stop = trackPrompt(baseUrl, promptId, signal);
  try {
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const response = await comfyFetch(baseUrl, `/history/${promptId}`, { method: "GET" }, signal);
      if (response.ok) {
        const data = await response.json() as Record<string, { status?: { status_str?: string; messages?: unknown }; outputs?: unknown }>;
        const item = data?.[promptId];
        if (item) {
          if (item.status?.status_str === "error") fail(`ComfyUI 质检失败：${JSON.stringify(item.status.messages ?? item.status).slice(0, 500)}`, 502);
          const text = textFromOutputs(item.outputs);
          if (text) return text;
          if (item.status?.status_str === "success") fail("质检工作流完成但没有文字输出", 502);
        }
      }
      await delay(2000, signal);
    }
  } finally {
    stop();
  }
  fail("质检工作流超时", 504);
}

export async function downloadOutput(baseUrl: string, item: ComfyOutput, signal?: AbortSignal) {
  const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder, type: item.type });
  const response = await comfyFetch(baseUrl, `/view?${query}`, { method: "GET" }, signal);
  if (!response.ok) fail(`下载生成结果失败：HTTP ${response.status}`, 502);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const limit = videoExtensions.has(item.filename.slice(item.filename.lastIndexOf(".")).toLowerCase()) ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
  if (!bytes.byteLength || bytes.byteLength > limit) fail("生成文件为空或超过大小限制");
  const suffix = item.filename.slice(item.filename.lastIndexOf(".")).toLowerCase();
  const mimeType = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  }[suffix];
  if (!mimeType) fail(`不支持的生成文件: ${item.filename}`);
  return { bytes, mimeType };
}
