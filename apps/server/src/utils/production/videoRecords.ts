import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, unlink, writeAtomic } from "@toonflow/file";
import { dirname, join, relative } from "node:path";
import type { GeneratedMedia, MediaGenerationRequest, QcVideoResult, VideoExecution, VideoQcReport, VideoQcState } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { readProduction, type ProductionConfig } from "@/utils/production/config";
import { runProductionQc } from "@/utils/production/qc";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { readQcRequirements } from "@/utils/production/qcRequirements";
import type { QcRequirement } from "@toonflow/tools-scaffold/runtime";

type VideoIdentity = Awaited<ReturnType<typeof videoIdentity>>;
type VideoRecord = {
  videoPath: string;
  size: number;
  mtimeMs: number;
  createdAt: string;
  generation?: { request: MediaGenerationRequest; execution?: VideoExecution };
  qc: VideoQcState;
  checklist?: string;
  rawQc?: string[];
  requirements?: QcRequirement[];
  qcPolicy?: QcPolicy;
};

type QcPolicy = Pick<ProductionConfig, "qcLevel" | "videoQcModelId" | "audioQcModelId" | "gemmaQcHost"> & { contractVersion: number };

const active = new Map<string, { checklist?: string; running: boolean; promise: Promise<QcVideoResult> }>();
let queue: Promise<unknown> = Promise.resolve();

async function videoIdentity(cwd: string, path: string) {
  const directory = await realpath(cwd);
  const target = await resolveWorkspacePath(directory, path);
  const info = await stat(target.path);
  if (!info.isFile()) throw new Error("成片路径不是文件");
  const videoPath = relative(directory, target.path).replaceAll("\\", "/");
  const identity = process.platform === "win32" ? target.path.toLowerCase() : target.path;
  const key = createHash("sha256").update(identity).digest("hex");
  return { directory, videoPath, size: info.size, mtimeMs: info.mtimeMs, recordPath: join(dirname(conf.path), "videoRecords", key + ".json") };
}

async function loadRecord(video: VideoIdentity) {
  const text = await readFile(video.recordPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return;
    throw error;
  });
  if (!text) return;
  const record = JSON.parse(text) as VideoRecord;
  return record.size === video.size && record.mtimeMs === video.mtimeMs ? record : undefined;
}

function newRecord(video: VideoIdentity, qc: VideoQcState): VideoRecord {
  return { videoPath: video.videoPath, size: video.size, mtimeMs: video.mtimeMs, createdAt: new Date().toISOString(), qc };
}

function qcPolicy({ qcLevel, videoQcModelId, audioQcModelId, gemmaQcHost }: ProductionConfig): QcPolicy {
  return { qcLevel, videoQcModelId, audioQcModelId, gemmaQcHost, contractVersion: 2 };
}

async function saveRecord(video: VideoIdentity, record: VideoRecord, exclusive = false) {
  await mkdir(dirname(video.recordPath), { recursive: true });
  await writeAtomic(video.recordPath, JSON.stringify(record), { mode: 0o600, exclusive });
}

export async function recordVideoOutputs(directory: string, assets: GeneratedMedia[], request: MediaGenerationRequest, execution?: VideoExecution) {
  const videos = await Promise.all(assets.map(asset => videoIdentity(directory, asset.path)));
  const production = readProduction();
  const auto = production.qcTrigger === "auto" && production.qcLevel !== "none";
  const written: string[] = [];
  try {
    for (const video of videos) {
      const previous = await loadRecord(video);
      if (previous) {
        // 已保存成片的 QC 记录可能早于任务完成标记；相同任务恢复时不可覆盖 QC 结论。
        if (!request.generationId || previous.generation?.request.generationId !== request.generationId
          || previous.generation?.execution?.promptId !== execution?.promptId
          || JSON.stringify(previous.generation?.request) !== JSON.stringify(request)) {
          throw new Error("成片已存在其他生成或质检记录，禁止覆盖");
        }
        continue;
      }
      await saveRecord(video, { ...newRecord(video, { status: auto ? "queued" : "notRequested" }), generation: { request, execution } }, true);
      written.push(video.recordPath);
    }
  } catch (error) {
    await Promise.all(written.map(path => unlink(path)));
    throw error;
  }
  if (auto) for (const video of videos) {
    // 成片已落盘，自动质检独立于发起生成的画布或对话。
    void scheduleQc(video, undefined, production).catch(error => console.error("自动成片质检失败", video.videoPath, error));
  }
}

function scheduleQc(video: VideoIdentity, checklist: string | undefined, production = readProduction(), signal?: AbortSignal) {
  const existing = active.get(video.recordPath);
  if (existing) {
    if (checklist !== undefined && checklist !== existing.checklist) {
      throw Object.assign(new Error("此成片正在质检，请完成后再使用新的验收要点"), { status: 409 });
    }
    return existing.promise;
  }
  const job = queue.then(async () => {
    const current = await videoIdentity(video.directory, video.videoPath);
    if (current.size !== video.size || current.mtimeMs !== video.mtimeMs) throw new Error("成片在等待质检期间已变化");
    const saved = await loadRecord(video) ?? newRecord(video, { status: "notRequested" });
    const rawQc: string[] = [];
    const record = { ...saved, checklist, rawQc, qcPolicy: qcPolicy(production) };
    await saveRecord(video, { ...record, qc: { status: "running" } });
    const task = active.get(video.recordPath);
    if (task) task.running = true;
    try {
      signal?.throwIfAborted();
      const requirements = await readQcRequirements(video.directory, saved.generation?.request);
      record.requirements = requirements;
      const result = await runProductionQc({
        directory: video.directory,
        videoPath: video.videoPath,
        checklist,
        production,
        generation: saved.generation?.request,
        requirements,
        onRawOutput: text => rawQc.push(text),
        signal: signal ?? AbortSignal.timeout(45 * 60_000),
      });
      const completed = await videoIdentity(video.directory, video.videoPath);
      if (completed.size !== video.size || completed.mtimeMs !== video.mtimeMs) throw new Error("成片在质检期间已变化");
      await saveRecord(video, { ...record, qc: { status: "completed", result } });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "质检未完成";
      await saveRecord(video, { ...record, qc: signal?.aborted ? { status: "interrupted" } : { status: "failed", message } });
      throw error;
    }
  }).finally(() => active.delete(video.recordPath));
  active.set(video.recordPath, { checklist, running: false, promise: job });
  // 共享质检资源按队列执行，单条失败不阻断后续成片。
  queue = job.catch(() => undefined);
  return job;
}

export async function getVideoQcStatus(directory: string, videoPath: string): Promise<VideoQcReport> {
  const video = await videoIdentity(directory, videoPath);
  const record = await loadRecord(video);
  const task = active.get(video.recordPath);
  const state = record?.qc ?? { status: "notRequested" as const };
  const generation = record?.generation;
  const parameters = generation ? {
    providerId: generation.request.providerId, modelId: generation.request.modelId,
    reviewId: generation.request.reviewId,
    duration: generation.request.duration, ratio: generation.request.ratio, execution: generation.execution,
  } : undefined;
  if (task && !task.running) return { status: "queued", generation: parameters };
  if (!task && (state.status === "queued" || state.status === "running")) return { status: "interrupted", generation: parameters };
  return { ...state, generation: parameters };
}

async function waitForQc(job: Promise<QcVideoResult>, signal?: AbortSignal) {
  if (!signal) return job;
  signal.throwIfAborted();
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([job, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

export async function checkRecordedVideo(directory: string, videoPath: string, checklist?: string, signal?: AbortSignal) {
  const video = await videoIdentity(directory, videoPath);
  signal?.throwIfAborted();
  const saved = await loadRecord(video);
  const normalized = checklist?.trim() || undefined;
  const production = readProduction();
  if (saved?.qc.status === "completed" && normalized === undefined && !active.has(video.recordPath)
    && JSON.stringify(saved.qcPolicy) === JSON.stringify(qcPolicy(production))) return saved.qc.result;
  return waitForQc(scheduleQc(video, normalized, production, signal), signal);
}
