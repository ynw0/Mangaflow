// ComfyUI 视频提交记录：同一 generationId 只能继续原任务，不得意外重复扣费。
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import type { GeneratedMedia, MediaGenerationRequest, VideoExecution } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { resolveComfyBaseUrl } from "@/utils/production/autodl";
import { cancelPrompt } from "@/utils/production/comfyui";

type Phase = "preparing" | "submitting" | "submitted" | "saved" | "completed" | "cancelled" | "failed";
type Job = {
  id: string;
  directory: string;
  fingerprint: string;
  phase: Phase;
  createdAt: string;
  updatedAt: string;
  execution?: VideoExecution;
  files?: GeneratedMedia[];
  error?: string;
};
type RunOptions = {
  directory: string;
  request: MediaGenerationRequest;
  generate: (options: {
    signal: AbortSignal;
    resume?: VideoExecution;
    submitting: () => Promise<void>;
    submitted: (execution: VideoExecution) => Promise<void>;
  }) => Promise<{ files: { bytes: Uint8Array; mimeType: string }[]; execution: VideoExecution }>;
  save: (files: { bytes: Uint8Array; mimeType: string }[], id: string, signal: AbortSignal) => Promise<GeneratedMedia[]>;
  record: (files: GeneratedMedia[], execution: VideoExecution) => Promise<void>;
};

const running = new Map<string, { promise: Promise<GeneratedMedia[]>; controller: AbortController }>();
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
  return { generationId: job.id, phase: job.phase, promptId: job.execution?.promptId,
    host: job.execution?.host, files: job.files, error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt,
    live: running.has(job.id), canResume: ["submitted", "saved"].includes(job.phase) };
}
export async function generationJobStatus(cwd: string, id: string) {
  const directory = await realpath(cwd);
  const job = await checkedJob(directory, id);
  if (!job) throw Object.assign(new Error("生成任务不存在"), { status: 404 });
  return publicStatus(job);
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
  if (job.phase === "completed" || job.phase === "cancelled" || job.phase === "failed") return publicStatus(job);
  if (job.phase === "submitting") throw Object.assign(new Error("远端提交状态未知，暂不能安全取消；请先核对 ComfyUI 队列"), { status: 409 });
  running.get(id)?.controller.abort(new Error("用户取消了视频生成任务"));
  if (job.execution && job.phase === "submitted") {
    const host = job.execution.host;
    if (host !== "local" && host !== "autodl") throw new Error("任务记录的 ComfyUI 主机无效");
    await cancelPrompt(await resolveComfyBaseUrl(undefined, host), job.execution.promptId);
  }
  const latest = await checkedJob(directory, id);
  if (latest && latest.phase !== "completed") {
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
  const active = running.get(id);
  if (active) return active.promise;
  const controller = new AbortController();
  const promise = (async () => {
    const directory = await realpath(options.directory);
    let job = await checkedJob(directory, id, request);
    if (!job) {
      const now = new Date().toISOString();
      job = { id, directory, fingerprint: signature(directory, request), phase: "preparing", createdAt: now, updatedAt: now };
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
      if (job.phase === "submitting") {
        throw new Error("服务器在 ComfyUI 提交阶段中断，无法判定是否已提交。请先核对远端队列，不会自动重复提交");
      }
      if (["cancelled", "failed"].includes(job.phase)) throw new Error("任务已终止；如要重新生成，请明确新建 generationId");
      let files = job.files;
      let execution = job.execution;
      if (job.phase !== "saved") {
        const output = await options.generate({
          signal: controller.signal, resume: job.phase === "submitted" ? execution : undefined,
          submitting: () => persist("submitting"),
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
      if (latest?.phase === "cancelled") return Promise.reject(error);
      if (job!.phase === "preparing") await persist("failed", { error: message });
      else if (job!.phase !== "completed" && job!.phase !== "cancelled") await persist(job!.phase, { error: message });
      throw error;
    }
  })().finally(() => running.delete(id));
  running.set(id, { promise, controller });
  return promise;
}
