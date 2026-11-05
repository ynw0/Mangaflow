// 扫描顺序是内置、数据目录、额外目录。同 id 使用先扫到的，后面的不覆盖；内容不同或版本更高时给出提示。
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "@toonflow/file";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseWorkflowBindings, type WorkflowBindings } from "@/utils/production/bindings";
import { readProduction, fail } from "@/utils/production/config";
import { resolveAppDirectory } from "@/resolveAppDirectory";

export type WorkflowKind = "image" | "video" | "qc";

export type WorkflowEntry = {
  id: string;
  label: string;
  kind: WorkflowKind;
  root: string;
  bindings: WorkflowBindings;
  workflowPath: string;
  version?: number;
  /** 二采工作流 JSON 里现成的一采、二采步数，不在代码里另写默认值。 */
  stepDefaults?: { firstPass: number; secondPass: number };
};

const labels: Record<string, string> = {
  "image/character_image": "角色设定图",
  "image/scene_image": "场景图",
  "image/prop_image": "道具原画",
  "image/flux3KleinT2i": "Flux.3 Klein 文生图",
  "image/flux3KleinDistilledT2i": "Flux.3 Klein 蒸馏文生图",
  "image/flux3KleinEdit": "Flux.3 Klein 图像编辑",
  "image/flux3KleinDistilledEdit": "Flux.3 Klein 蒸馏图像编辑",
  "video/h3_ref2va_1080p": "H3 全参参考",
  "video/h3_erca_16x9": "二采 MiniMax H3 16:9",
  "video/h3_erca_9x16": "二采 MiniMax H3 9:16",
  "video/h3_flf_repair": "H3 首尾帧",
  "qc/gemma4E2b": "Gemma 4 E2B 质检",
  "qc/gemma4E4b": "Gemma 4 E4B 质检",
  "qc/gemma4_12B": "Gemma 4 12B 质检",
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
  const kind = id.startsWith("image/") ? "image" : id.startsWith("video/") ? "video" : id.startsWith("qc/") ? "qc" : undefined;
  if (!kind) fail(`工作流 ${id} 必须放在 image、video 或 qc 目录下`);
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
    version: parsed.version,
    stepDefaults: await readStepDefaults(workflowPath, parsed),
  };
}

// 只读 bindings 指向的整数。读不到就不上报步数，生成时保留 JSON 里的原值。
function readBoundInteger(source: unknown, path: string) {
  let current = source;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) return;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" && Number.isInteger(current) && current >= 1 ? current : undefined;
}

async function readStepDefaults(workflowPath: string, bindings: WorkflowBindings) {
  const firstTarget = bindings.bindings.find(item => item.source === "first_pass_steps")?.target;
  const secondTarget = bindings.bindings.find(item => item.source === "second_pass_steps")?.target;
  if (!firstTarget || !secondTarget) return;
  const parsed = JSON.parse(await readFile(workflowPath, "utf8")) as unknown;
  const firstPass = readBoundInteger(parsed, firstTarget);
  const secondPass = readBoundInteger(parsed, secondTarget);
  if (firstPass == null || secondPass == null) return;
  return { firstPass, secondPass };
}

const warnedNotices = new Set<string>();

function rootLabel(root: string) {
  const current = resolve(root);
  if (current === resolve(resolveBuiltinWorkflowsRoot())) return "内置";
  if (current === resolve(customWorkflowRoot())) return "数据目录";
  return "额外目录";
}

async function fingerprint(entry: WorkflowEntry) {
  const hash = createHash("sha256");
  hash.update(await readFile(join(entry.root, `${entry.id}.bindings.yaml`)));
  hash.update("\0");
  hash.update(await readFile(entry.workflowPath));
  return hash.digest("hex");
}

export async function loadWorkflowCatalog(): Promise<{ entries: WorkflowEntry[]; notices: string[] }> {
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

  const chosen = new Map<string, WorkflowEntry>();
  const notices: string[] = [];
  for (const root of roots) {
    for (const id of (await walkBindings(root)).sort((a, b) => a.localeCompare(b, "zh-CN"))) {
      const entry = await readEntry(root, id);
      const current = chosen.get(id);
      if (!current) {
        chosen.set(id, entry);
        continue;
      }
      if (await fingerprint(current) === await fingerprint(entry)) continue;
      const currentVersion = current.version ?? 0;
      const laterVersion = entry.version ?? 0;
      const message = laterVersion > currentVersion
        ? `${rootLabel(root)}里的 ${id} 版本 ${laterVersion} 高于${rootLabel(current.root)}版本 ${currentVersion || "未标注"}，当前仍使用${rootLabel(current.root)}。`
        : `${rootLabel(root)}里的 ${id} 与${rootLabel(current.root)}内容不同，当前使用${rootLabel(current.root)}。`;
      notices.push(message);
      if (!warnedNotices.has(message)) {
        warnedNotices.add(message);
        console.warn(message);
      }
    }
  }
  return { entries: [...chosen.values()], notices };
}

export async function listWorkflowCatalog(): Promise<WorkflowEntry[]> {
  return (await loadWorkflowCatalog()).entries;
}

export async function findWorkflow(id: string) {
  const entry = (await listWorkflowCatalog()).find(item => item.id === id);
  if (!entry) fail(`找不到工作流: ${id}`);
  return entry;
}

// 从实际槽位推导输入范围，目录展示和生成校验共用这一规则。
export function imageReferenceRange(entry: WorkflowEntry) {
  const slots = entry.bindings.bindings.flatMap(item => {
    const index = /^refs\.slot([1-9]\d*)$/.exec(item.source)?.[1];
    return item.kind === "image" && index ? [{ index: Number(index), required: item.required }] : [];
  });
  return { min: Math.max(0, ...slots.filter(item => item.required).map(item => item.index)), max: slots.length };
}

export function workflowSummary(entry: WorkflowEntry) {
  return { id: entry.id, label: entry.label, usage: entry.bindings.usage, ...(entry.kind === "image" ? { imageReferences: imageReferenceRange(entry) } : {}) };
}

// 二采的分辨率是节点 8 百万像素（倍数 32）再乘节点 151 的放大倍率。
function samplingFor(entry: WorkflowEntry) {
  const sources = new Set(entry.bindings.bindings.map(item => item.source));
  if (!sources.has("megapixels") || !sources.has("upscale")) return;
  const steps = entry.stepDefaults;
  return {
    megapixels: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.98, 1, 1.2, 1.5, 1.8, 2],
    multiple: 32,
    upscaleMin: 1,
    upscaleMax: 4,
    upscaleStep: 0.05,
    upscaleDefault: 2,
    // 范围与生成请求校验一致。用户没指定时固定一采 8、二采 4，不跟工作流 JSON 里的旧步数。
    ...(steps ? {
      firstPassMin: 1,
      firstPassMax: 64,
      firstPassDefault: 8,
      secondPassMin: 1,
      secondPassMax: 64,
      secondPassDefault: 4,
    } : {}),
  };
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
    const imageReferences = imageReferenceRange(entry);
    const mode = [
      ...(imageReferences.min === 0 ? ["text"] : []),
      ...(imageReferences.min <= 1 && imageReferences.max >= 1 ? ["singleImage"] : []),
      ...(imageReferences.max >= 2 ? ["multiReference"] : []),
    ];
    return {
      providerId: "comfyui",
      providerLabel: "ComfyUI",
      modelId: entry.id,
      label: entry.label,
      type: "image" as const,
      supportsPrice: false,
      usage: entry.bindings.usage,
      imageReferences,
      mode,
      imageSizes: ["2048x768", "1024x1024", "1344x768", "768x1024", "768x1344", "1024x768", "1248x832", "832x1248", "1568x672"],
      imageRatios: ["8:3", "1:1", "16:9", "3:4", "9:16", "4:3", "3:2", "2:3", "21:9"],
    };
  }
  if (entry.kind !== "video") fail(`${entry.id} 不是出视频工作流`);
  const sampling = samplingFor(entry);
  return {
    providerId: "comfyui",
    providerLabel: "ComfyUI",
    modelId: entry.id,
    label: entry.label,
    usage: entry.bindings.usage,
    type: "video" as const,
    supportsPrice: false,
    mode: frames
      ? ["startEndRequired"]
      : needsImage
        ? ["singleImage", ["imageReference:9", "videoReference:1", audioReference]]
        : ["text", "singleImage", ["imageReference:9", "videoReference:1", audioReference]],
    durationResolutionMap: [{ duration: durations, resolution: sampling ? [] : ["1080P"] }],
    sampling,
    audio: hasAudio ? "optional" as const : false,
  };
}
