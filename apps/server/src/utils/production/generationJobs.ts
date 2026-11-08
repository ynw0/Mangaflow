// ComfyUI 视频提交记录：同一 generationId 只能继续原任务，不得意外重复扣费。
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import type { GeneratedMedia, MediaGenerationRequest, VideoExecution } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { resolveComfyBaseUrl } from "@/utils/production/autodl";
import { cancelPrompt, findSubmittedPromptByClientId } from "@/utils/production/comfyui";
import { getVideoQcStatus } from "@/utils/production/videoRecords";

type Phase = "preparing" | "submitting" | "submitted" | "saved" | "completed" | "cancelled" | "failed";
type Job = {
  id: string;
  directory: string;
  fingerprint: string;
  /** 原始请求只保存在用户本机的 0600 任务记录里，列表 API 不返回提示词或参考图。 */
  request?: MediaGenerationRequest;
  phase: Phase;
  createdAt: string;
  updatedAt: string;
  execution?: VideoExecution;
  submission?: Omit<VideoExecution, "promptId">;
  files?: GeneratedMedia[];
  error?: string;
};
type RunOptions = {
  directory: string;
  request: MediaGenerationRequest;
  generate: (options: {
    signal: AbortSignal;
    resume?: VideoExecution;
    submitting: (submission?: Omit<VideoExecution, "promptId">) => Promise<void>;
    submitted: (execution: VideoExecution) => Promise<void>;
  }) => Promise<{ files: { bytes: Uint8Array; mimeType: string }[]; execution: VideoExecution }>;
  save: (files: { bytes: Uint8Array; mimeType: string }[], id: string, signal: AbortSignal) => Promise<GeneratedMedia[]>;
  record: (files: GeneratedMedia[], execution: VideoExecution) => Promise<void>;
};

const running = new Map<string, { promise: Promise<GeneratedMedia[]>; controller: AbortController; directory: string; fingerprint: string }>();
const directoryPath = join(dirname(conf.path), "generationJobs");

function pathOf(id: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error("generationId 不是有效的 UUID");
  return join(directoryPath, `${id}.json`);
}
function signature(directory: string, request: MediaGenerationRequest) {
  const { generationId: _id, ...input } = request;
  return createHash("sha256").update(JSON.stringify([directory, input])).digest("hex");
}
async function readJob(id: string) {
  const raw = await readFile(pathOf(id), "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined;
    throw err;
  });
  return raw ? JSON.parse(raw) as Job : undefined;
}
async function saveJob(job: Job, exclusive = false) {
  job.updatedAt = new Date().toISOString();
  await mkdir(directoryPath, { recursive: true });
  await writeAtomic(pathOf(job.id), JSON.stringify(job), { mode: 0o600, exclusive });
}
async function checkedJob(directory: string, id: string, request?: MediaGenerationRequest) {
  const job = await readJob(id);
  if (job && job.directory !== directory) throw Object.assign(new Error("任务不属于当前工作区"), { status: 403 });
  if (job && request && job.fingerprint !== signature(directory, request)) {
    throw Object.assign(new Error("同一 generationId 的生成参数已改变；禁止用旧任务编号重新提交"), { status: 409 });
  }
  return job;
}
async function validFiles(directory: string, files: GeneratedMedia[]) {
  for (const file of files) {
    const found = await resolveWorkspacePath(directory, file.path);
    if (!(await stat(found.path)).isFile()) throw new Error("任务记录的成片已经被移动或删除");
  }
}
function publicStatus(job: Job) {
  const phaseReady = ["preparing", "submitted", "saved", "completed"].includes(job.phase);
  return { generationId: job.id, phase: job.phase, promptId: job.execution?.promptId,
    host: job.execution?.host ?? job.submission?.host, outputDirectory: job.request?.outputDirectory, files: job.files,
    error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt,
    live: running.has(job.id), canResume: ["submitted", "saved"].includes(job.phase),
    canResumeById: phaseReady && Boolean(job.request) };
}

/** 只以已落盘的 client_id 对账；查不到保持锁定，绝不再次 POST。 */
async function reconcileSubmission(job: Job) {
  if (job.phase !== "submitting") return;
  if (!job.submission) throw Object.assign(new Error("旧任务缺少提交主机和关联编号，无法自动核对，仍禁止重提"), { status: 409 });
  const host = job.submission.host;
  if (host !== "local" && host !== "autodl") throw Object.assign(new Error("任务提交主机记录无效"), { status: 409 });
  const baseUrl = await resolveComfyBaseUrl(undefined, host);
  const promptId = await findSubmittedPromptByClientId(baseUrl, job.id);
  if (!promptId) {
    throw Object.assign(new Error("远端队列与最近 500 条历史未找到原任务，提交是否成功仍不确定；未重新提交"), { status: 409 });
  }
  job.execution = { ...job.submission, promptId };
  job.phase = "submitted";
  job.error = undefined;
  await saveJob(job);
}

/** 使用已落盘的原始参数恢复同一个任务，不允许调用方猜测提示词或模型配置。 */
export async function getStoredGenerationRequest(cwd: string, id: string): Promise<MediaGenerationRequest> {
  const directory = await realpath(cwd);
  const job = await checkedJob(directory, id);
  if (!job) throw Object.assign(new Error("生成任务不存在"), { status: 404 });
  if (["cancelled", "failed"].includes(job.phase)) {
    throw Object.assign(new Error("原任务已终止，禁止使用旧任务编号恢复"), { status: 409 });
  }
  if (!job.request || job.request.generationId !== id || signature(directory, job.request) !== job.fingerprint) {
    throw Object.assign(new Error("旧任务缺少可信原始生成参数，不能只凭任务 ID 重新生成"), { status: 409 });
  }
  if (job.request.providerId !== "comfyui") throw Object.assign(new Error("只有 ComfyUI 视频任务支持持久化恢复"), { status: 400 });
  if (job.phase === "submitting" && !running.has(id)) await reconcileSubmission(job);
  return job.request;
}
export async function generationJobStatus(cwd: string, id: string) {
  const directory = await realpath(cwd);
  const job = await checkedJob(directory, id);
  if (!job) throw Object.assign(new Error("生成任务不存在"), { status: 404 });
  const status = publicStatus(job);
  // 已完成的记录才有可信 QC 登记；生成/保存中的视频不能误判为人工免检。
  if (job.phase !== "completed" || !job.files?.length) return status;
  const videoQc = await Promise.all(job.files.filter(file => file.mediaType === "video").map(async file => ({
    path: file.path,
    ...(await getVideoQcStatus(directory, file.path)),
  })));
  return { ...status, videoQc };
}
export async function listGenerationJobs(cwd: string) {
  const directory = await realpath(cwd);
  const names = await readdir(directoryPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const jobs = await Promise.all(names.filter(name => /^[a-f0-9-]{36}\.json$/i.test(name)).map(async name => {
    const job = await readJob(name.slice(0, -5));
    return job?.directory === directory ? publicStatus(job) : undefined;
  }));
  return jobs.filter((job): job is NonNullable<typeof job> => !!job)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
}
export async function cancelGenerationJob(cwd: string, id: string) {
  const directory = await realpath(cwd);
  const job = await checkedJob(directory, id);
  if (!job) throw Object.assign(new Error("生成任务不存在"), { status: 404 });
  // 成片已经保存后不再撤销视频/QC 登记；调用方可直接取回已有结果。
  if (["saved", "completed", "cancelled", "failed"].includes(job.phase)) return publicStatus(job);
  if (job.phase === "submitting") throw Object.assign(new Error("远端提交状态未知，暂不能安全取消；请先核对 ComfyUI 队列"), { status: 409 });
  const active = running.get(id);
  if (active && active.directory !== directory) throw Object.assign(new Error("任务工作区不匹配"), { status: 403 });
  active?.controller.abort(new Error("用户取消了视频生成任务"));
  if (job.execution && job.phase === "submitted") {
    const host = job.execution.host;
    if (host !== "local" && host !== "autodl") throw new Error("任务记录的 ComfyUI 主机无效");
    await cancelPrompt(await resolveComfyBaseUrl(undefined, host), job.execution.promptId);
  }
  // 等运行协程收尾之后再落取消状态，避免旧协程把 cancelled 覆盖成 submitted/saved。
  await active?.promise.catch(() => undefined);
  const latest = await checkedJob(directory, id);
  if (!latest) throw new Error("取消时未找到持久化任务记录");
  if (latest.phase === "submitting") throw Object.assign(new Error("远端提交状态未知，请先核对 ComfyUI 队列"), { status: 409 });
  if (!["saved", "completed", "cancelled"].includes(latest.phase)) {
    latest.phase = "cancelled";
    latest.error = "用户已请求停止；远端中断可能需要时间生效";
    await saveJob(latest);
  }
  return publicStatus((await checkedJob(directory, id))!);
}
export async function runGenerationJob(options: RunOptions) {
  const { request } = options;
  if (!request.generationId) throw new Error("持久化生成必须有 generationId");
  const id = request.generationId;
  const directory = await realpath(options.directory);
  const fingerprint = signature(directory, request);
  const active = running.get(id);
  if (active) {
    if (active.directory !== directory || active.fingerprint !== fingerprint) {
      throw Object.assign(new Error("任务 ID 已绑定其他工作区或参数，禁止合并执行"), { status: 409 });
    }
    return active.promise;
  }
  const controller = new AbortController();
  const promise = (async () => {
    let job = await checkedJob(directory, id, request);
    if (!job) {
      const now = new Date().toISOString();
      job = { id, directory, fingerprint, request, phase: "preparing", createdAt: now, updatedAt: now };
      await saveJob(job, true);
    }
    const persist = async (phase: Phase, patch: Partial<Job> = {}) => {
      Object.assign(job!, patch, { phase });
      await saveJob(job!);
    };
    try {
      if (job.phase === "completed") {
        await validFiles(directory, job.files ?? []);
        return job.files ?? [];
      }
      if (job.phase === "submitting") await reconcileSubmission(job);
      if (job.phase === "submitted" && !job.execution?.promptId) {
        throw new Error("任务已提交但缺少 promptId；禁止重新提交工作流");
      }
      if (["cancelled", "failed"].includes(job.phase)) throw new Error("任务已终止；如要重新生成，请明确新建 generationId");
      let files = job.files;
      let execution = job.execution;
      if (job.phase !== "saved") {
        const output = await options.generate({
          signal: controller.signal, resume: job.phase === "submitted" ? execution : undefined,
          submitting: submission => persist("submitting", { submission }),
          submitted: item => persist("submitted", { execution: item }),
        });
        controller.signal.throwIfAborted();
        execution = output.execution;
        files = await options.save(output.files, id, controller.signal);
        await persist("saved", { execution, files });
      }
      if (!files?.length || !execution) throw new Error("任务缺少已保存的输出或执行记录");
      await validFiles(directory, files);
      await options.record(files, execution);
      await persist("completed", { error: undefined });
      return files;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 取消可能来自另一条 HTTP 请求。重新检查持久化状态，防止运行协程覆盖取消结果。
      const latest = await checkedJob(directory, id);
      if (latest?.phase === "cancelled") throw error;
      if (job!.phase === "preparing") await persist("failed", { error: message });
      else if (job!.phase !== "completed" && job!.phase !== "cancelled") await persist(job!.phase, { error: message });
      throw error;
    }
  })().finally(() => running.delete(id));
  running.set(id, { promise, controller, directory, fingerprint });
  return promise;
}
