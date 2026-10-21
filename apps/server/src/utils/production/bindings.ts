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
  capabilities: { durationSeconds?: { min: number; max: number } };
  bindings: WorkflowBinding[];
};

export function parseWorkflowBindings(text: string): WorkflowBindings {
  const workflow = text.match(/^workflow:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!workflow) failMessage("绑定文件缺少 workflow");
  const label = text.match(/^label:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
  const min = Number(text.match(/^\s*min:\s*(\d+)\s*$/m)?.[1]);
  const max = Number(text.match(/^\s*max:\s*(\d+)\s*$/m)?.[1]);
  const capabilities = Number.isInteger(min) && Number.isInteger(max) && min > 0 && min <= max
    ? { durationSeconds: { min, max } }
    : {};
  const bindings: WorkflowBinding[] = [];
  for (const block of text.split(/\n(?=- )/)) {
    if (!block.trimStart().startsWith("- ")) continue;
    const source = block.match(/source:\s*(\S+)/)?.[1];
    const target = block.match(/target:\s*(\S+)/)?.[1];
    const kind = block.match(/kind:\s*(\S+)/)?.[1] ?? "value";
    if (!source || !target) failMessage("绑定缺少 source 或 target");
    if (kind !== "value" && kind !== "image" && kind !== "video" && kind !== "audio") failMessage(`未知 binding.kind: ${kind}`);
    bindings.push({ source, target, kind, required: !/required:\s*false/.test(block) });
  }
  if (!bindings.length) failMessage("绑定文件没有 bindings");
  return { workflow, label, capabilities, bindings };
}

/** 把内存里的 bindings 写成与内置文件同款的 yaml 文本。 */
export function serializeWorkflowBindings(value: WorkflowBindings) {
  const lines = [`workflow: ${value.workflow}`];
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