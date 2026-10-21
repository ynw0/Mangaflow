// 扫描内置目录、用户数据自定义目录、额外工作流目录；同名只保留先扫到的。
import { readdir, readFile, stat } from "@toonflow/file";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseWorkflowBindings, type WorkflowBindings } from "@/utils/production/bindings";
import { readProduction, fail } from "@/utils/production/config";
import { resolveAppDirectory } from "@/resolveAppDirectory";

export type WorkflowKind = "image" | "video";

export type WorkflowEntry = {
  id: string;
  label: string;
  kind: WorkflowKind;
  root: string;
  bindings: WorkflowBindings;
  workflowPath: string;
};

const labels: Record<string, string> = {
  "image/character_image": "角色设定图",
  "image/scene_image": "场景图",
  "image/prop_image": "道具原画",
  "video/h3_ref2va_1080p": "H3 全参参考",
  "video/h3_erca_16x9": "二采 MiniMax H3 16:9",
  "video/h3_erca_9x16": "二采 MiniMax H3 9:16",
  "video/h3_flf_repair": "H3 首尾帧",
};

/** 内置 workflows 目录（与 upload 共用，按仓库根解析）。 */
export function resolveBuiltinWorkflowsRoot() {
  return resolve(resolveAppDirectory(), "workflows");
}

function builtinRoots() {
  return [resolveBuiltinWorkflowsRoot()];
}

/** 用户数据下的自定义工作流目录（上传落盘处，不写仓库 workflows/）。 */
export function customWorkflowRoot() {
  const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(resolveAppDirectory(), "data");
  return resolve(dataDirectory, "workflows");
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function walkBindings(root: string, dir = root): Promise<string[]> {
  const names = await readdir(dir);
  const found: string[] = [];
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) found.push(...await walkBindings(root, full));
    else if (info.isFile() && name.endsWith(".bindings.yaml")) {
      const id = relative(root, full).replace(/\\/g, "/").replace(/\.bindings\.yaml$/, "");
      found.push(id);
    }
  }
  return found;
}

function insideRoot(root: string, target: string) {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function readEntry(root: string, id: string): Promise<WorkflowEntry> {
  const kind = id.startsWith("image/") ? "image" : id.startsWith("video/") ? "video" : undefined;
  if (!kind) fail(`工作流 ${id} 必须放在 image 或 video 目录下`);
  const bindingsPath = join(root, `${id}.bindings.yaml`);
  const parsed = parseWorkflowBindings(await readFile(bindingsPath, "utf8"));
  const workflowPath = resolve(dirname(bindingsPath), parsed.workflow);
  if (!insideRoot(root, workflowPath)) fail(`工作流文件越出目录: ${id}`);
  const info = await stat(workflowPath).catch(() => undefined);
  if (!info?.isFile()) fail(`工作流 JSON 不存在: ${id}`);
  return {
    id,
    label: parsed.label?.trim() || labels[id] || id.split("/").at(-1) || id,
    kind,
    root,
    bindings: parsed,
    workflowPath,
  };
}

export async function listWorkflowCatalog(): Promise<WorkflowEntry[]> {
  const roots: string[] = [];
  for (const candidate of builtinRoots()) {
    if (await isDirectory(candidate)) {
      roots.push(candidate);
      break;
    }
  }
  const custom = customWorkflowRoot();
  if (await isDirectory(custom) && !roots.some(root => resolve(root) === resolve(custom))) roots.push(custom);
  const extra = readProduction().workflowRoot;
  if (extra && await isDirectory(extra) && !roots.some(root => resolve(root) === resolve(extra))) roots.push(extra);

  const entries: WorkflowEntry[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const id of (await walkBindings(root)).sort((a, b) => a.localeCompare(b, "zh-CN"))) {
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push(await readEntry(root, id));
    }
  }
  return entries;
}

export async function findWorkflow(id: string) {
  const entry = (await listWorkflowCatalog()).find(item => item.id === id);
  if (!entry) fail(`找不到工作流: ${id}`);
  return entry;
}

export function toMediaModel(entry: WorkflowEntry) {
  const limits = entry.bindings.capabilities.durationSeconds;
  const durations = limits
    ? Array.from({ length: limits.max - limits.min + 1 }, (_, index) => limits.min + index)
    : [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const audioSlots = entry.bindings.bindings.filter(item => item.kind === "audio").length;
  const hasAudio = audioSlots > 0;
  const audioReference = `audioReference:${audioSlots > 0 ? audioSlots : 1}`;
  const frames = entry.bindings.bindings.some(item => item.source === "refs.first_frame");
  const needsImage = entry.bindings.bindings.some(item => item.kind === "image" && item.required);
  if (entry.kind === "image") {
    return {
      providerId: "comfyui",
      providerLabel: "ComfyUI",
      modelId: entry.id,
      label: entry.label,
      type: "image" as const,
      supportsPrice: false,
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["2048x768", "1024x1024", "1344x768", "768x1024"],
      imageRatios: ["8:3", "1:1", "16:9", "3:4"],
    };
  }
  return {
    providerId: "comfyui",
    providerLabel: "ComfyUI",
    modelId: entry.id,
    label: entry.label,
    type: "video" as const,
    supportsPrice: false,
    mode: frames
      ? ["startEndRequired"]
      : needsImage
        ? ["singleImage", ["imageReference:9", "videoReference:1", audioReference]]
        : ["text", "singleImage", ["imageReference:9", "videoReference:1", audioReference]],
    durationResolutionMap: [{ duration: durations, resolution: ["1080P"] }],
    audio: hasAudio ? "optional" as const : false,
  };
}