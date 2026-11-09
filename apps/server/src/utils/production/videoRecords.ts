import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, unlink, writeAtomic } from "@toonflow/file";
import { dirname, join, relative } from "node:path";
import type { GeneratedMedia, MediaGenerationRequest, QcVideoResult, VideoExecution, VideoQcReport, VideoQcState } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { readProduction, type ProductionConfig } from "@/utils/production/config";
import { prepareAgentVideoQc, runProductionQc } from "@/utils/production/qc";
import { parseQcPayload, summarizeQc } from "@/utils/production/qcResult";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { readQcRequirements } from "@/utils/production/qcRequirements";
import type { AgentVideoQcSubmission, QcRequirement, VideoQcActionResult } from "@toonflow/tools-scaffold/runtime";

type VideoIdentity = Awaited<ReturnType<typeof videoIdentity>>;
type VideoRecord = {
  workspaceDirectory?: string; // 新版记录持久化工作区，供服务重启后重新入队 QC
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
  agentResult?: QcVideoResult;
  agentDeliveredRevision?: string;
};

type QcPolicy = Pick<ProductionConfig, "qcMethod" | "qcLevel" | "videoQcModelId" | "audioQcModelId" | "gemmaQcHost"> & { contractVersion: number };

const active = new Map<string, { checklist?: string; running: boolean; promise: Promise<VideoQcActionResult> }>();
const submissions = new Set<string>();
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
  return { workspaceDirectory: video.directory, videoPath: video.videoPath, size: video.size, mtimeMs: video.mtimeMs, createdAt: new Date().toISOString(), qc };
}

function qcPolicy({ qcMethod, qcLevel, videoQcModelId, audioQcModelId, gemmaQcHost }: ProductionConfig): QcPolicy {
  return { qcMethod, qcLevel, videoQcModelId, audioQcModelId, gemmaQcHost, contractVersion: 3 };
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
  const pendingQc: VideoIdentity[] = [];
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
        // 崩溃后可能已登记视频，却尚未启动自动 QC；恢复只重排未完成的记录。
        if (auto && (previous.qc.status === "queued" || previous.qc.status === "running")) pendingQc.push(video);
        continue;
      }
      await saveRecord(video, { ...newRecord(video, { status: auto ? "queued" : "notRequested" }), generation: { request, execution } }, true);
      written.push(video.recordPath);
      if (auto) pendingQc.push(video);
    }
  } catch (error) {
    await Promise.all(written.map(path => unlink(path)));
    throw error;
  }
  if (auto) for (const video of pendingQc) {
    // 成片已落盘，自动质检独立于发起生成的画布或对话。
    void scheduleQc(video, undefined, production).catch(error => console.error("自动成片质检失败", video.videoPath, error));
  }
}

function scheduleQc(video: VideoIdentity, checklist: string | undefined, production = readProduction(), signal?: AbortSignal) {
  if (submissions.has(video.recordPath)) throw Object.assign(new Error("主 Agent 正在提交此成片质检结论"), { status: 409 });
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
    const record = { ...saved, agentResult: undefined, agentDeliveredRevision: undefined, checklist, rawQc, qcPolicy: qcPolicy(production) };
    await saveRecord(video, { ...record, qc: { status: "running" } });
    const task = active.get(video.recordPath);
    if (task) task.running = true;
    try {
      signal?.throwIfAborted();
      const requirements = await readQcRequirements(video.directory, saved.generation?.request);
      record.requirements = requirements;
      const captured = production.qcMethod !== "model" && production.qcLevel !== "none"
        ? await prepareAgentVideoQc(video.directory, video.videoPath, requirements, production.qcLevel === "videoAudio",
          production.qcMethod === "agentFramesAndModel" && production.qcLevel === "videoAudio", signal) : undefined;
      if (captured && production.qcMethod === "agentFrames") {
        const waiting = { status: "awaitingAgent" as const, agent: captured.agent };
        await saveRecord(video, { ...record, qc: waiting });
        return waiting;
      }
      let result: QcVideoResult;
      try {
        result = await runProductionQc({
          directory: video.directory,
          videoPath: video.videoPath,
          checklist,
          production,
          generation: saved.generation?.request,
          requirements,
          evidence: captured?.raw,
          onRawOutput: text => rawQc.push(text),
          signal: signal ?? AbortSignal.timeout(45 * 60_000),
        });
      } catch (error) {
        if (!captured || signal?.aborted) throw error;
        const waiting = { status: "awaitingAgent" as const, agent: captured.agent,
          modelError: error instanceof Error ? error.message : "专用 QC 执行失败" };
        await saveRecord(video, { ...record, qc: waiting });
        return waiting;
      }
      const completed = await videoIdentity(video.directory, video.videoPath);
      if (completed.size !== video.size || completed.mtimeMs !== video.mtimeMs) throw new Error("成片在质检期间已变化");
      if (captured) {
        const waiting = { status: "awaitingAgent" as const, agent: captured.agent, modelResult: result };
        await saveRecord(video, { ...record, qc: waiting });
        return waiting;
      }
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

/** 只恢复已获准自动 QC、并在重启前处于排队/运行中的成片；绝不重新生成视频。 */
export async function resumePendingAutomaticQc() {
  const production = readProduction();
  if (production.qcTrigger !== "auto" || production.qcLevel === "none") return 0;
  const root = join(dirname(conf.path), "videoRecords");
  const entries = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  let scheduled = 0;
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}\.json$/i.test(entry)) continue;
    try {
      const recordPath = join(root, entry);
      const saved = JSON.parse(await readFile(recordPath, "utf8")) as VideoRecord;
      if (!saved.workspaceDirectory || !["queued", "running"].includes(saved.qc.status)) continue;
      const video = await videoIdentity(saved.workspaceDirectory, saved.videoPath);
      // 视频路径、修改时间、大小和记录哈希必须与原始记录一致。
      if (video.recordPath !== recordPath || !(await loadRecord(video))) continue;
      if (active.has(video.recordPath)) continue;
      void scheduleQc(video, saved.checklist, production).catch(error =>
        console.error("重启后自动质检失败", video.videoPath, error));
      scheduled++;
    } catch (error) {
      console.warn("跳过无法恢复的成片 QC 记录", entry, error);
    }
  }
  return scheduled;
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
  return { ...state, generation: parameters, agentResult: record?.agentResult };
}

async function waitForQc(job: Promise<VideoQcActionResult>, signal?: AbortSignal) {
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
  if (saved?.qc.status === "awaitingAgent" && normalized === undefined && !active.has(video.recordPath)
    && JSON.stringify(saved.qcPolicy) === JSON.stringify(qcPolicy(production))) return saved.qc;
  if (saved?.qc.status === "completed" && normalized === undefined && !active.has(video.recordPath)
    && JSON.stringify(saved.qcPolicy) === JSON.stringify(qcPolicy(production))) return saved.qc.result;
  return waitForQc(scheduleQc(video, normalized, production, signal), signal);
}

export async function getAgentVideoQcEvidence(directory: string, videoPath: string) {
  const video = await videoIdentity(directory, videoPath);
  if (submissions.has(video.recordPath)) throw Object.assign(new Error("质检证据正在更新"), { status: 409 });
  submissions.add(video.recordPath);
  try {
    const record = await loadRecord(video);
    if (record?.qc.status !== "awaitingAgent") throw new Error("该成片当前没有待主 Agent 验收的抽帧任务");
    if (JSON.stringify(record.qcPolicy) !== JSON.stringify(qcPolicy(readProduction()))) throw new Error("质检设置已变化，请重新发起质检");
    const images: { data: string; mimeType: string }[] = [];
    for (const frame of record.qc.agent.frames) {
      const bytes = await readFile((await resolveWorkspacePath(video.directory, frame.path)).path);
      if (createHash("sha256").update(bytes).digest("hex") !== frame.digest) throw new Error(`质检帧 ${frame.path} 已被修改，请重新发起质检`);
      images.push({ data: bytes.toString("base64"), mimeType: "image/jpeg" });
    }
    record.agentDeliveredRevision = record.qc.agent.revision;
    await saveRecord(video, record);
    return { evidence: record.qc.agent, images };
  } finally { submissions.delete(video.recordPath); }
}

export async function submitAgentVideoQc(directory: string, input: AgentVideoQcSubmission): Promise<VideoQcReport> {
  const video = await videoIdentity(directory, input.videoPath);
  if (active.has(video.recordPath) || submissions.has(video.recordPath)) throw Object.assign(new Error("该成片质检任务正在更新，请稍后提交"), { status: 409 });
  submissions.add(video.recordPath);
  try {
    const record = await loadRecord(video);
    if (!record || record.qc.status !== "awaitingAgent") throw new Error("该成片当前没有待主 Agent 验收的任务");
    const pending = record.qc;
    if (pending.agent.revision !== input.revision) throw Object.assign(new Error("抽帧版本已变化，请重新读取画面证据"), { status: 409 });
    if (record.agentDeliveredRevision !== input.revision) throw new Error("必须先调用 getVideoQcFrames 读取实际图片，再提交主 Agent 结论");
    if (JSON.stringify(record.qcPolicy) !== JSON.stringify(qcPolicy(readProduction()))) throw new Error("质检设置已变化，请重新发起质检");
    const parsed = parseQcPayload(JSON.stringify({ checks: input.checks }), "video", false, pending.agent.requirements, pending.agent.timelineCoverage, false);
    const agentResult: QcVideoResult = { ...parsed, technical: pending.agent.technical, videoModelId: "mainAgent", audioModelId: "", merged: false };
    if (pending.agent.audioExpected && !pending.modelResult) {
      Object.assign(agentResult, summarizeQc([...agentResult.checks, { domain: "audio", result: "unverified", evidence: "主 Agent 只收到画面帧，未听辨声音内容。" }]));
    }
    record.agentResult = agentResult;
    if (pending.modelError) {
      await saveRecord(video, { ...record, qc: { status: "failed", message: `主 Agent 结论已保存；专用 QC 失败：${pending.modelError}` } });
    } else {
      const model = pending.modelResult;
      const result: QcVideoResult = model ? { ...model, ...summarizeQc([...agentResult.checks, ...model.checks]),
        assessments: { agent: agentResult, model } } : { ...agentResult, assessments: { agent: agentResult } };
      await saveRecord(video, { ...record, qc: { status: "completed", result } });
    }
    return getVideoQcStatus(directory, input.videoPath);
  } finally { submissions.delete(video.recordPath); }
}
