// 读取 Manga 同款 .bindings.yaml：workflow、时长能力、source/target/kind。
export type WorkflowBinding = {
  source: string;
  target: string;
  kind: "value" | "image" | "video" | "audio";
  required: boolean;
};

export type WorkflowBindings = {
  workflow: string;
  label?: string;
  version?: number;
  capabilities: { durationSeconds?: { min: number; max: number } };
  bindings: WorkflowBinding[];
};

function unquote(value: string) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function bindingField(current: { source?: string; target?: string; kind?: WorkflowBinding["kind"]; required?: boolean }, key: string, value: string) {
  if (!value) failMessage(`绑定缺少 ${key}`);
  if (key === "source") {
    if (current.source) failMessage("绑定重复 source");
    current.source = value;
    return;
  }
  if (key === "target") {
    if (current.target) failMessage("绑定重复 target");
    current.target = value;
    return;
  }
  if (key === "kind") {
    if (value !== "value" && value !== "image" && value !== "video" && value !== "audio") failMessage(`未知 binding.kind: ${value}`);
    current.kind = value;
    return;
  }
  if (key === "required") {
    if (value !== "true" && value !== "false") failMessage("required 必须是 true 或 false");
    current.required = value === "true";
    return;
  }
  failMessage(`未知 binding 字段: ${key}`);
}

export function parseWorkflowBindings(text: string): WorkflowBindings {
  let workflow = "";
  let label: string | undefined;
  let version: number | undefined;
  let durationMin: number | undefined;
  let durationMax: number | undefined;
  let sawDuration = false;
  let inCapabilities = false;
  let inDuration = false;
  let inBindings = false;
  let current: { source?: string; target?: string; kind?: WorkflowBinding["kind"]; required?: boolean } | undefined;
  const bindings: WorkflowBinding[] = [];
  const finish = () => {
    if (!current) return;
    if (!current.source || !current.target) failMessage("绑定缺少 source 或 target");
    bindings.push({ source: current.source, target: current.target, kind: current.kind ?? "value", required: current.required !== false });
    current = undefined;
  };
  for (const raw of text.split(/\r?\n/)) {
    const comment = raw.search(/(^|\s)#/);
    const line = (comment >= 0 ? raw.slice(0, comment) : raw).trimEnd();
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (indent === 0 && !content.startsWith("-")) {
      finish();
      inCapabilities = false;
      inDuration = false;
      inBindings = false;
      const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(content);
      if (!pair) failMessage("绑定文件格式无效");
      const key = pair[1] ?? "";
      const value = unquote(pair[2] ?? "");
      if (key === "workflow") {
        if (!value || /\s/.test(value)) failMessage("绑定文件缺少 workflow");
        workflow = value;
      } else if (key === "label") {
        if (!value) failMessage("label 不能为空");
        label = value;
      } else if (key === "version") {
        if (version !== undefined) failMessage("绑定重复 version");
        if (!/^[1-9]\d*$/.test(value)) failMessage("version 必须是正整数");
        version = Number(value);
      } else if (key === "capabilities") {
        if (value) failMessage("capabilities 不能写成单行");
        inCapabilities = true;
      } else if (key === "bindings") {
        if (value) failMessage("bindings 不能写成单行");
        inBindings = true;
      } else failMessage(`未知字段: ${key}`);
      continue;
    }
    if (content.startsWith("- ")) {
      if (!inBindings) failMessage("绑定列表位置无效");
      finish();
      const pair = /^- ([A-Za-z0-9_]+):\s*(.*)$/.exec(content);
      if (!pair) failMessage("绑定项格式无效");
      current = {};
      bindingField(current, pair[1] ?? "", unquote(pair[2] ?? ""));
      continue;
    }
    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(content);
    if (!pair) failMessage("绑定文件格式无效");
    const key = pair[1] ?? "";
    const value = unquote(pair[2] ?? "");
    if (current) {
      bindingField(current, key, value);
      continue;
    }
    if (inCapabilities && key === "duration_seconds" && !value) {
      inDuration = true;
      sawDuration = true;
      continue;
    }
    if (inDuration && (key === "min" || key === "max")) {
      if (!/^\d+$/.test(value)) failMessage(`duration_seconds.${key} 无效`);
      const number = Number(value);
      if (key === "min") durationMin = number;
      else durationMax = number;
      continue;
    }
    failMessage(`未知字段: ${key}`);
  }
  finish();
  if (!workflow) failMessage("绑定文件缺少 workflow");
  if (sawDuration || durationMin !== undefined || durationMax !== undefined) {
    if (!Number.isInteger(durationMin) || !Number.isInteger(durationMax) || durationMin! <= 0 || durationMin! > durationMax!) {
      failMessage("duration_seconds 的 min、max 无效");
    }
  }
  if (!bindings.length) failMessage("绑定文件没有 bindings");
  const capabilities = durationMin !== undefined && durationMax !== undefined ? { durationSeconds: { min: durationMin, max: durationMax } } : {};
  return { workflow, label, version, capabilities, bindings };
}

/** 把内存里的 bindings 写成与内置文件同款的 yaml 文本。 */
export function serializeWorkflowBindings(value: WorkflowBindings) {
  const lines = [`workflow: ${value.workflow}`];
  if (value.version !== undefined) lines.push(`version: ${value.version}`);
  if (value.label?.trim()) lines.push(`label: ${value.label.trim()}`);
  const limits = value.capabilities.durationSeconds;
  if (limits) {
    lines.push("capabilities:", "  duration_seconds:", `    min: ${limits.min}`, `    max: ${limits.max}`);
  }
  lines.push("bindings:");
  for (const item of value.bindings) {
    lines.push(`- source: ${item.source}`, `  target: ${item.target}`, `  kind: ${item.kind}`);
    if (!item.required) lines.push("  required: false");
  }
  return `${lines.join("\n")}\n`;
}

function failMessage(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}