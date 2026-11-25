import { createHash } from "node:crypto";
import { createReadStream, readFile, realpath, stat } from "@toonflow/file";
import { fail } from "@/utils/production/config";
import type { PreparedComfyWorkflow } from "@/utils/production/run";
import { videoAudioInputs } from "@/utils/production/h3Workflow";
import type { WorkflowBindings } from "@/utils/production/bindings";

type ReviewFile = { source: string; path: string; size: number; digest: string };
const maxReviewFileBytes = 100 * 1024 * 1024;
export type VideoReviewSnapshot = {
  directory: string;
  modelId: string;
  host: string;
  prompt: string;
  seedMode: string;
  parameters: Record<string, unknown>;
  references: ReviewFile[];
  workflow: string;
};

function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

// 生成前核对提示词与参考文件内容；采样与部署由生成入口校验。
export function videoPromptReviewScope(snapshot: VideoReviewSnapshot) {
  const { bindings, workflow } = JSON.parse(snapshot.workflow) as {
    bindings: WorkflowBindings;
    workflow: Record<string, unknown>;
  };
  const { duration, aspect_ratio } = snapshot.parameters;
  const aspect = aspect_ratio ?? [snapshot.parameters["params.width"], snapshot.parameters["params.height"]];
  const slots = new Map<string, (typeof snapshot.references)[number] & { kind?: string }>();
  for (const item of snapshot.references) {
    const kind = bindings.bindings.find(binding => binding.source === item.source && binding.kind !== "value")?.kind;
    const reference = { ...item, kind };
    slots.set(serialize(reference), reference);
  }
  const references = [...slots.values()].sort((left, right) => left.source.localeCompare(right.source));
  return {
    directory: snapshot.directory, prompt: snapshot.prompt, format: bindings.promptFormat,
    duration, aspect, audio: videoAudioInputs(workflow).length > 0, references,
  };
}

async function requireReviewFile(path: string) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxReviewFileBytes) fail("审核参考须为不超过 100 MB 的文件");
}

async function digestReviewFile(path: string, signal?: AbortSignal) {
  await requireReviewFile(path);
  const hash = createHash("sha256");
  let size = 0;
  // 多读一字节即可识别在读取过程中超出上限的文件。
  for await (const chunk of createReadStream(path, { end: maxReviewFileBytes, signal })) {
    size += chunk.length;
    hash.update(chunk);
  }
  if (!size || size > maxReviewFileBytes) fail("审核参考为空或超过 100 MB");
  return { size, digest: hash.digest("hex") };
}

async function readReviewFile(path: string, signal?: AbortSignal) {
  await requireReviewFile(path);
  const bytes = new Uint8Array(await readFile(path, { signal }));
  if (!bytes.length || bytes.length > maxReviewFileBytes) fail("审核参考为空或超过 100 MB");
  return { bytes, size: bytes.length, digest: createHash("sha256").update(bytes).digest("hex") };
}

export async function captureVideoReview(directory: string, prepared: PreparedComfyWorkflow, signal?: AbortSignal): Promise<VideoReviewSnapshot> {
  const root = await realpath(directory);
  const references: ReviewFile[] = [];
  for (const input of prepared.inputs) {
    if (input.kind === "value" || typeof input.value !== "string" || !input.value) continue;
    signal?.throwIfAborted();
    const { size, digest } = await digestReviewFile(input.value, signal).catch(error => {
      signal?.throwIfAborted();
      fail(`参考素材 ${input.source} 无法核对：${error instanceof Error ? error.message : String(error)}，请修复参考素材后重试`, 409);
    });
    references.push({ source: input.source, path: input.value, size, digest });
  }
  const parameters = Object.fromEntries(prepared.inputs.filter(input => input.kind === "value" && input.source !== "prompt" && input.source !== "image_prompt")
    .map(input => [input.source, input.value]));
  parameters.duration ??= prepared.context.duration;
  const checkpoint = prepared.context.checkpoint_name;
  if (checkpoint && checkpoint !== prepared.entry.checkpoint?.defaultName) parameters.checkpoint_name = checkpoint;
  if (prepared.context.h3_options !== undefined) parameters.h3_options = prepared.context.h3_options;
  return {
    directory: process.platform === "win32" ? root.toLowerCase() : root,
    modelId: prepared.entry.id,
    host: prepared.host,
    prompt: prepared.context.prompt,
    seedMode: prepared.seedMode,
    parameters,
    references,
    workflow: serialize({ bindings: prepared.entry.bindings, workflow: prepared.reviewWorkflow }),
  };
}

export async function verifyReviewFile(path: string, expected: ReviewFile, signal?: AbortSignal) {
  const { bytes, digest, size } = await readReviewFile(path, signal).catch(() => {
    signal?.throwIfAborted();
    fail(`参考素材 ${expected.source} 无法读取，请修复后重新生成`, 409);
  });
  if (digest !== expected.digest || size !== expected.size) fail(`参考素材 ${expected.source} 的文件内容在准备生成后已变化，请确认当前素材后重新生成`, 409);
  // 校验与上传使用同一份字节，避免文件在两次读取之间被替换。
  return bytes;
}
