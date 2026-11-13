import { createHash } from "node:crypto";
import { createReadStream, mkdir, readFile, realpath, stat, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import conf from "@/utils/conf";
import { fail } from "@/utils/production/config";
import type { PreparedComfyWorkflow } from "@/utils/production/run";
import { draftCinematicPlanSchema } from "@/utils/production/videoPlan";

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
      fail(`参考素材 ${input.source} 无法核对：${error instanceof Error ? error.message : String(error)}，请修复后重新审核`, 409);
    });
    references.push({ source: input.source, path: input.value, size, digest });
  }
  const parameters = Object.fromEntries(prepared.inputs.filter(input => input.kind === "value" && input.source !== "prompt" && input.source !== "image_prompt")
    .map(input => [input.source, input.value]));
  return {
    directory: process.platform === "win32" ? root.toLowerCase() : root,
    modelId: prepared.entry.id,
    host: prepared.host,
    prompt: prepared.context.prompt,
    seedMode: prepared.seedMode,
    parameters,
    references,
    // 最终绑定结果包含省略参数保留的工作流默认值；键顺序不影响审核。
    workflow: serialize({ bindings: prepared.entry.bindings, workflow: prepared.reviewWorkflow }),
  };
}

export function requireSameVideoReview(approved: VideoReviewSnapshot, current: VideoReviewSnapshot) {
  const changed: string[] = [];
  for (const [key, label] of [["directory", "工作区"], ["modelId", "工作流"], ["host", "GPU 主机"],
    ["prompt", "英文提示词"], ["seedMode", "种子模式"]] as const) {
    if (approved[key] !== current[key]) changed.push(label);
  }
  const parameterNames: Record<string, string> = {
    seed: "种子值", duration: "时长", aspect_ratio: "画幅", megapixels: "百万像素",
    upscale: "放大倍率", first_pass_steps: "一采步数", second_pass_steps: "二采步数",
  };
  for (const key of new Set([...Object.keys(approved.parameters), ...Object.keys(current.parameters)])) {
    if (serialize(approved.parameters[key]) !== serialize(current.parameters[key])) changed.push(parameterNames[key] ?? key);
  }
  if (serialize(approved.references) !== serialize(current.references)) {
    const sources = new Set([...approved.references, ...current.references].map(item => item.source));
    for (const source of sources) {
      const before = approved.references.find(item => item.source === source);
      const after = current.references.find(item => item.source === source);
      if (serialize(before) !== serialize(after)) changed.push(`参考素材 ${source} 的顺序、路径或文件内容`);
    }
  }
  if (!changed.length && approved.workflow !== current.workflow) changed.push("工作流内容或绑定配置");
  if (changed.length) fail(`审核已过期：${changed.join("、")}已变化，请按变化重新审核`, 409);
}

function cachePath(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) fail("视频提示词缓存编号无效", 400);
  return join(dirname(conf.path), "videoReviews", "cache", key + ".json");
}

/** 相同镜头合同与已验素材只复用已获服务端审核许可的结果。 */
export async function findReusableVideoReview(key: string, snapshot: VideoReviewSnapshot) {
  const text = await readFile(cachePath(key), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!text) return;
  const { reviewId } = JSON.parse(text) as { reviewId?: string };
  if (!reviewId) fail("视频提示词缓存缺少审核编号", 409);
  const record = await readApprovedVideoReview(reviewId);
  requireSameVideoReview(record.snapshot, { ...snapshot, prompt: record.snapshot.prompt });
  const promptZh = record.audit.promptZh;
  if (!record.snapshot.prompt || typeof promptZh !== "string" || !promptZh.trim()) {
    fail("已存审核记录缺少完整中英文提示词", 409);
  }
  return { reviewId, prompt: record.snapshot.prompt, promptZh, cinematicPlan: draftCinematicPlanSchema.parse(record.audit.cinematicPlan), review: record.audit.review };
}

function reviewPath(reviewId: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(reviewId)) fail("审核编号无效，请重新审核", 409);
  return join(dirname(conf.path), "videoReviews", `${reviewId}.json`);
}

export async function saveVideoReview(snapshot: VideoReviewSnapshot, audit: Record<string, unknown>, cacheKey?: string) {
  const reviewId = crypto.randomUUID();
  const path = reviewPath(reviewId);
  await mkdir(dirname(path), { recursive: true });
  // 编号仅为服务端记录索引；审核成功的宿主链路是唯一写入入口。
  await writeAtomic(path, JSON.stringify({ status: "approved", createdAt: new Date().toISOString(), snapshot, audit }), { exclusive: true, mode: 0o600 });
  if (cacheKey) {
    const target = cachePath(cacheKey);
    await mkdir(dirname(target), { recursive: true });
    await writeAtomic(target, JSON.stringify({ reviewId }), { mode: 0o600 });
  }
  return reviewId;
}

export async function requireVideoReview(reviewId: string | undefined, snapshot: VideoReviewSnapshot) {
  if (!reviewId) fail("此 H3 请求尚无服务端审核记录，请先完成提示词审核", 409);
  const record = await readApprovedVideoReview(reviewId);
  requireSameVideoReview(record.snapshot, snapshot);
  // 新提交的对白须经过逐句时序审核；成片读取和已提交任务恢复不经过此入口。
  if (/<\/?d\b/i.test(snapshot.prompt) && !draftCinematicPlanSchema.safeParse(record.audit.cinematicPlan).success) {
    fail("该审核记录缺少逐句对白时序，请重新审核后再提交生成", 409);
  }
}

export async function readApprovedVideoReview(reviewId: string) {
  const text = await readFile(reviewPath(reviewId), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") fail("服务端找不到此审核记录，请重新审核", 409);
    throw error;
  });
  const record = JSON.parse(text) as { status: string; snapshot: VideoReviewSnapshot; audit: Record<string, unknown> };
  if (record.status !== "approved" || !record.snapshot) fail("服务端审核记录未通过，请重新审核", 409);
  return record;
}

export async function verifyReviewFile(path: string, expected: ReviewFile, signal?: AbortSignal) {
  const { bytes, digest, size } = await readReviewFile(path, signal).catch(() => {
    signal?.throwIfAborted();
    fail(`审核已过期：参考素材 ${expected.source} 无法读取，请修复后重新审核`, 409);
  });
  if (digest !== expected.digest || size !== expected.size) fail(`审核已过期：参考素材 ${expected.source} 的文件内容已变化，请重新审核`, 409);
  // 校验与上传使用同一份字节，避免文件在两次读取之间被替换。
  return bytes;
}
