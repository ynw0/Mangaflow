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

export async function uploadInput(baseUrl: string, filePath: string, subfolder: string, signal?: AbortSignal) {
  const bytes = new Uint8Array(await readFile(filePath));
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

export async function submitWorkflow(baseUrl: string, workflow: Record<string, unknown>, signal?: AbortSignal) {
  const response = await comfyFetch(baseUrl, "/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
  }, signal);
  const data = await response.json().catch(() => undefined) as { prompt_id?: string; error?: { message?: string }; node_errors?: Record<string, unknown> } | undefined;
  if (!response.ok) fail(data?.error?.message || `提交工作流失败：HTTP ${response.status}`, 502);
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
  const deadline = Date.now() + (kind === "video" ? 20 : 10) * 60_000;
  const extensions = kind === "video" ? videoExtensions : imageExtensions;
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
        if (outputs.length) return outputs[0]!;
        if (item.status?.status_str === "success") fail("ComfyUI 完成但没有图片或视频输出", 502);
      }
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 2000));
  }
  fail(kind === "video" ? "视频生成超时" : "出图超时", 504);
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
