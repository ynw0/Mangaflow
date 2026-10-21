// 上传 Comfy API JSON：用设置里的语言模型对照现有 bindings 生成新 yaml，校验通过才落盘到 data/workflows。
import { mkdir, readFile, readdir, stat, unlink, writeAtomic } from "@toonflow/file";
import { join, resolve } from "node:path";
import { getConfiguredModel, listAiModels, streamAi } from "@/utils/ai";
import {
  parseWorkflowBindings,
  serializeWorkflowBindings,
  type WorkflowBindings,
} from "@/utils/production/bindings";
import { customWorkflowRoot, listWorkflowCatalog } from "@/utils/production/catalog";
import { fail } from "@/utils/production/config";

const slugPattern = /^[a-z][a-z0-9_]{0,63}$/;
const allowedSources = new Set([
  "prompt", "seed", "duration",
  "refs.slot1", "refs.slot2", "refs.slot3", "refs.slot4", "refs.slot5",
  "refs.slot6", "refs.slot7", "refs.slot8", "refs.slot9",
  "refs.first_frame", "refs.last_frame",
  "media.video1", "media.audio1", "media.audio2", "media.audio3",
]);

async function builtinWorkflowRoot() {
  const here = import.meta.dirname;
  for (const candidate of [
    resolve(here, "../../../../../workflows"),
    resolve(here, "../../../../workflows"),
    resolve(process.cwd(), "workflows"),
  ]) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // 继续试下一个候选路径
    }
  }
  fail("找不到内置 workflows 目录");
}

function normalizeId(raw: string) {
  const text = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const slug = text.startsWith("video/") ? text.slice("video/".length) : text;
  if (!slugPattern.test(slug)) fail("工作流 id 须为 video/<小写字母开头的标识>，例如 video/my_h3");
  return { id: `video/${slug}`, slug };
}

function asApiJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("请上传 ComfyUI 导出的 API 格式 JSON 对象");
  const nodes = value as Record<string, unknown>;
  const ids = Object.keys(nodes);
  if (!ids.length) fail("API JSON 里没有节点");
  for (const id of ids) {
    const node = nodes[id];
    if (!node || typeof node !== "object" || Array.isArray(node)) fail(`节点 ${id} 格式无效`);
    const record = node as Record<string, unknown>;
    if (typeof record.class_type !== "string" || !record.class_type.trim()) fail(`节点 ${id} 缺少 class_type`);
    if (!record.inputs || typeof record.inputs !== "object" || Array.isArray(record.inputs)) fail(`节点 ${id} 缺少 inputs`);
  }
  return nodes;
}

function summarizeApiJson(nodes: Record<string, unknown>, maxChars = 48_000) {
  const lines: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    const record = node as { class_type: string; inputs: Record<string, unknown> };
    const fields = Object.entries(record.inputs).map(([key, value]) => {
      if (value == null || typeof value === "object") return key;
      const text = String(value);
      return `${key}=${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
    });
    lines.push(`${id} ${record.class_type} { ${fields.join(", ")} }`);
  }
  let text = lines.join("\n");
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…(已截断)`;
  return text;
}

function targetExists(nodes: Record<string, unknown>, target: string) {
  const parts = target.split(".");
  let current: unknown = nodes;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

function validateBindings(parsed: WorkflowBindings, nodes: Record<string, unknown>) {
  if (!parsed.bindings.some(item => item.source === "prompt")) fail("bindings 必须包含 source: prompt");
  for (const item of parsed.bindings) {
    if (!allowedSources.has(item.source)) fail(`不支持的 binding.source: ${item.source}`);
    if (!targetExists(nodes, item.target)) fail(`binding.target 对不上 API JSON 节点: ${item.target}`);
    if (item.kind === "image" && !item.source.startsWith("refs.")) fail(`${item.source} 的 kind 应为 image 对应 refs.*`);
    if (item.kind === "video" && !item.source.startsWith("media.video")) fail(`${item.source} 的 kind 应为 video`);
    if (item.kind === "audio" && !item.source.startsWith("media.audio")) fail(`${item.source} 的 kind 应为 audio`);
    if (item.kind === "value" && !["prompt", "seed", "duration"].includes(item.source)) {
      fail(`${item.source} 的 kind 应为 value（prompt/seed/duration）`);
    }
  }
}

function extractYaml(text: string) {
  const fenced = text.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/i)?.[1];
  const body = (fenced ?? text).trim();
  const start = body.search(/^workflow:\s*/m);
  if (start < 0) fail("模型未返回有效的 bindings.yaml（缺少 workflow:）");
  return body.slice(start).trim();
}

async function loadTemplateTexts() {
  const root = await builtinWorkflowRoot();
  const videoDir = join(root, "video");
  const names = (await readdir(videoDir).catch(() => [] as string[]))
    .filter(name => name.endsWith(".bindings.yaml"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .slice(0, 2);
  if (!names.length) fail("内置视频 bindings 模板缺失，无法生成");
  const samples: string[] = [];
  for (const name of names) {
    samples.push(await readFile(join(videoDir, name), "utf8"));
  }
  return samples;
}

function resolveLanguageModel(providerId?: string, modelId?: string) {
  if (providerId?.trim() && modelId?.trim()) return getConfiguredModel(providerId.trim(), modelId.trim());
  const models = listAiModels();
  const first = models[0];
  if (!first) fail("请先在设置 → 语言模型中配置可用模型");
  return getConfiguredModel(first.providerId, first.modelId);
}

async function generateBindingsYaml(options: {
  apiSummary: string;
  templates: string[];
  slug: string;
  label?: string;
  providerId?: string;
  modelId?: string;
}) {
  const configured = resolveLanguageModel(options.providerId, options.modelId);
  const templateBlock = options.templates.map((text, index) => `【模板 ${index + 1}】\n${text.trim()}`).join("\n\n");
  const userPrompt = [
    "请根据下方 ComfyUI API 工作流节点摘要，参照模板生成一份新的 .bindings.yaml。",
    "要求：",
    "1. 只输出 yaml 正文（可包在 yaml 代码围栏里），不要解释。",
    "2. 字段风格与模板一致：workflow、可选 capabilities.duration_seconds、bindings 列表。",
    "3. source 只能使用：prompt、seed、duration、refs.slot1-9、refs.first_frame、refs.last_frame、media.video1、media.audio1-3。",
    "4. target 必须是「节点id.inputs.字段名」，且节点与字段必须出现在摘要中。",
    "5. kind 为 value|image|video|audio；可选参考槽 required: false。",
    "6. 必须包含 prompt；能识别到种子/时长/参考图/音视频就绑定。",
    `7. workflow 写成: ./${options.slug}_api.json`,
    options.label?.trim() ? `8. 可写 label: ${options.label.trim()}` : "8. 可不写 label。",
    "",
    templateBlock,
    "",
    "【API 节点摘要】",
    options.apiSummary,
  ].join("\n");

  const stream = streamAi(configured, {
    systemPrompt: "你是 ComfyUI 工作流 bindings 编写助手。只输出符合 Mangaflow 现有视频 bindings.yaml 形态的内容。",
    messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
  }, new AbortController().signal);

  for await (const _event of stream) {
    // 排空流，取最终 message
  }
  const message = await stream.result();
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    fail(message.errorMessage || "语言模型生成 bindings 失败");
  }
  const text = message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map(part => part.text)
    .join("\n")
    .trim();
  if (!text) fail("语言模型未返回 bindings 文本");
  return extractYaml(text);
}

export async function uploadVideoWorkflow(input: {
  apiJson: unknown;
  id: string;
  label?: string;
  providerId?: string;
  modelId?: string;
}) {
  const { id, slug } = normalizeId(input.id);
  const nodes = asApiJson(input.apiJson);
  const catalog = await listWorkflowCatalog();
  if (catalog.some(item => item.id === id)) {
    fail(`工作流 id 已存在：${id}。自定义与内置均不覆盖，请换一个名字。`);
  }

  const root = customWorkflowRoot();
  const videoDir = join(root, "video");
  const jsonPath = join(videoDir, `${slug}_api.json`);
  const bindingsPath = join(videoDir, `${slug}.bindings.yaml`);
  // 落盘前先挡已有文件，避免模型白跑一轮
  for (const path of [jsonPath, bindingsPath]) {
    try {
      if ((await stat(path)).isFile()) fail(`工作流文件已存在：${path.split(/[\\/]/).at(-1)}。不覆盖，请换 id。`);
    } catch {
      // 不存在即可
    }
  }

  const templates = await loadTemplateTexts();
  const yamlFromModel = await generateBindingsYaml({
    apiSummary: summarizeApiJson(nodes),
    templates,
    slug,
    label: input.label,
    providerId: input.providerId,
    modelId: input.modelId,
  });

  let parsed: WorkflowBindings;
  try {
    parsed = parseWorkflowBindings(yamlFromModel);
  } catch (error) {
    fail(error instanceof Error ? `bindings 校验失败：${error.message}` : "bindings 校验失败");
  }
  parsed = {
    ...parsed,
    workflow: `./${slug}_api.json`,
    label: input.label?.trim() || parsed.label,
  };
  validateBindings(parsed, nodes);
  const yamlText = serializeWorkflowBindings(parsed);

  await mkdir(videoDir, { recursive: true });
  try {
    await writeAtomic(jsonPath, `${JSON.stringify(nodes, null, 2)}\n`, { exclusive: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
    if (code === "EEXIST") fail(`工作流文件已存在：${slug}_api.json。不覆盖，请换 id。`);
    throw error;
  }
  try {
    await writeAtomic(bindingsPath, yamlText, { exclusive: true });
  } catch (error) {
    await unlink(jsonPath).catch(() => undefined);
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
    if (code === "EEXIST") fail(`bindings 已存在：${slug}.bindings.yaml。不覆盖，请换 id。`);
    throw error;
  }

  return {
    id,
    label: parsed.label?.trim() || slug,
    providerId: (input.providerId?.trim() || listAiModels()[0]?.providerId) ?? "",
    modelId: (input.modelId?.trim() || listAiModels()[0]?.modelId) ?? "",
  };
}