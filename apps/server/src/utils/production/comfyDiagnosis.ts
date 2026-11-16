import { redactSettings, redactedSecret } from "@/lib/secrets";
import { readComfyDiagnosticEndpoint } from "@/utils/production/comfyui";
import { readGenerationDiagnosis } from "@/utils/production/generationJobs";

const ansiEscape = /\x1b\[[\d;?]*[ -/]*[@-~]/g;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function redactLog(text: string) {
  return text.replace(ansiEscape, "")
    .replace(/(https?:\/\/)[^\s/"']+:[^\s/"']+@/gi, `$1${redactedSecret}@`)
    .replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi, `$1?${redactedSecret}`)
    .replace(/(\bBearer\s+)[\w.\-/+=]+/gi, `$1${redactedSecret}`)
    .replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w-]{16,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, redactedSecret)
    .replace(/^(\s*(?:set-cookie|cookie)\s*:\s*).*/gim, `$1${redactedSecret}`)
    .replace(/(["']?\b(?:[\w-]*(?:api[_-]?key|token|password|secret)|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, `$1${redactedSecret}`);
}

function evidenceText(value: unknown): string {
  if (typeof value === "string") return redactLog(value);
  return JSON.stringify(redactSettings(value), (key, item) => {
    // 执行错误附带的节点输入可能含剧本与工作流参数；诊断仅需报错和堆栈。
    if (["current_inputs", "current_outputs", "prompt", "workflow", "extra_data", "inputs"].includes(key)) return undefined;
    return typeof item === "string" ? redactLog(item) : item;
  }, 2);
}

function queueEvidence(value: unknown, taskId: string, promptId?: string) {
  const queue = asRecord(value);
  if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error("队列响应格式无法识别");
  const matches = (row: unknown) => Array.isArray(row) && (promptId ? row[1] === promptId : asRecord(row[3]).client_id === taskId);
  const running = queue.queue_running.find(matches);
  const pending = queue.queue_pending.find(matches);
  return { state: running ? "running" : pending ? "pending" : "notFound",
    promptId: (running ?? pending)?.[1], runningCount: queue.queue_running.length, pendingCount: queue.queue_pending.length };
}

function systemEvidence(value: unknown) {
  const { system: rawSystem, devices } = asRecord(value);
  const system = asRecord(rawSystem);
  if (!rawSystem || !Array.isArray(devices)) throw new Error("系统状态响应格式无法识别");
  return {
    os: system.os, python: system.python_version, pytorch: system.pytorch_version, comfyui: system.comfyui_version,
    devices: devices.map(device => {
      const raw = asRecord(device);
      return { name: raw.name, type: raw.type, memoryTotal: raw.vram_total, memoryFree: raw.vram_free };
    }),
  };
}

function terminalEvidence(value: unknown, promptId?: string) {
  const { entries } = asRecord(value);
  if (!Array.isArray(entries)) throw new Error("终端缓冲响应格式无法识别");
  const lines = entries.flatMap((entry, index) => {
    const { m, t } = asRecord(entry);
    return typeof m === "string" ? [{ index: index + 1, text: m, time: t }] : [];
  });
  const related = new Set<number>();
  for (const [index, line] of lines.entries()) {
    if (promptId && line.text.includes(promptId)) {
      // 缓冲区没有任务字段，ID 附近的上下文只作为关联线索。
      for (let offset = Math.max(0, index - 4); offset <= Math.min(lines.length - 1, index + 8); offset++) related.add(offset);
    }
    if (/^\s*(?:\[(?:INFO|WARNING|ERROR)\]\s*)?(?:[* ]*Python version:|ComfyUI version:|pytorch version:|Device: cuda|.*CUDA driver version is insufficient|Error loading custom node|Cannot import .*custom_nodes|ModuleNotFoundError:|ImportError:|CUDA initialization:)/im.test(line.text)) related.add(index);
  }
  return { bufferedEntries: lines.length, selectedEntries: lines.filter((_, index) => related.has(index)) };
}

export async function collectComfyDiagnosis(cwd: string, id: string | undefined, options: {
  terminal?: boolean; suppliedLog?: string; signal?: AbortSignal;
}) {
  options.signal?.throwIfAborted();
  if (!id) {
    if (!options.suppliedLog) throw Object.assign(new Error("请提供生成任务编号或相关日志"), { status: 400 });
    return { sources: { suppliedLog: redactLog(options.suppliedLog) } as Record<string, string>,
      unavailable: ["未关联 MangaFlow 任务，本次证据来自用户提供的日志。"] };
  }
  const { job, target, evidence } = await readGenerationDiagnosis(cwd, id);
  options.signal?.throwIfAborted();
  const sources: Record<string, string> = { task: evidenceText(job) };
  const unavailable: string[] = [];
  if (evidence) sources.recordedError = evidenceText(evidence);
  if (options.suppliedLog) sources.suppliedLog = redactLog(options.suppliedLog);
  const baseUrl = target?.target?.baseUrl;
  if (!baseUrl) {
    unavailable.push("任务未记录原 ComfyUI 地址，无法查询原实例。");
    return { sources, unavailable };
  }
  async function query<T>(name: string, path: string, select: (data: unknown) => T) {
    try {
      const selected = select(await readComfyDiagnosticEndpoint(baseUrl!, path, options.signal));
      sources[name] = evidenceText(selected);
      return selected;
    } catch (error) {
      options.signal?.throwIfAborted();
      unavailable.push(redactLog(error instanceof Error ? error.message : `无法读取 ${name}`));
    }
  }
  const [queue] = await Promise.all([
    query("queue", "/queue", value => queueEvidence(value, id, job.promptId)),
    query("system", "/system_stats", systemEvidence),
  ]);
  const promptId = job.promptId ?? (typeof queue?.promptId === "string" ? queue.promptId : undefined);
  await Promise.all([
    promptId ? query("history", `/history/${encodeURIComponent(promptId)}`, value => {
      const entry = asRecord(value)[promptId];
      return { promptId, found: !!entry, status: asRecord(entry).status };
    }) : undefined,
    options.terminal ? query("terminal", "/internal/logs/raw", value => terminalEvidence(value, promptId)) : undefined,
  ]);
  return { sources, unavailable };
}
