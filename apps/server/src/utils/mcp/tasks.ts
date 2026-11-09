import { mkdir, readFile, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import conf from "@/utils/conf";

type Task = {
  taskId: string; directory: string; tool: string; input: unknown;
  status: "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  createdAt: string; updatedAt: string; result?: unknown; error?: string;
};
const active = new Map<string, AbortController>();
const starting = new Map<string, Promise<Task>>();
const taskPath = (id: string) => join(dirname(conf.path), "mcpTasks", `${z.uuid().parse(id)}.json`);
async function save(task: Task, exclusive = false) {
  task.updatedAt = new Date().toISOString();
  const path = taskPath(task.taskId);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, JSON.stringify(task), { mode: 0o600, exclusive });
}
async function read(id: string) {
  const text = await readFile(taskPath(id), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return;
    throw error;
  });
  return text ? JSON.parse(text) as Task : undefined;
}
function visible(task: Task) {
  const { input: _input, directory: _directory, ...status } = task;
  return status;
}

// ACT: 单进程执行、磁盘记录结果；重启后标记中断，不猜测上游状态或自动重提付费请求。
export async function startMcpTask(options: {
  taskId: string; directory: string; tool: string; input: unknown; signal: AbortSignal;
  execute(signal: AbortSignal): Promise<unknown>;
}): Promise<ReturnType<typeof visible>> {
  const { taskId, directory, tool, signal } = options;
  const input = JSON.parse(JSON.stringify(options.input)) as unknown;
  z.uuid().parse(taskId);
  const pending = starting.get(taskId);
  if (pending) { await pending; return startMcpTask(options); }
  const initialization = (async (): Promise<Task> => {
    signal.throwIfAborted();
    const existing = await read(taskId);
    if (existing) {
      if (existing.directory !== directory || existing.tool !== tool || !isDeepStrictEqual(existing.input, input)) {
        throw Object.assign(new Error("任务 ID 已绑定其他工作区、工具或参数"), { status: 409 });
      }
      if (existing.status === "running" && !active.has(taskId)) {
        existing.status = "interrupted";
        existing.error = "宿主已重启，任务执行状态未知；先核对供应商或持久化视频任务，禁止直接换 ID 重提";
        await save(existing);
      }
      return existing;
    }
    const now = new Date().toISOString();
    const task: Task = { taskId, directory, tool, input, status: "running", createdAt: now, updatedAt: now };
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    active.set(taskId, controller);
    try { await save(task, true); }
    catch (error) { active.delete(taskId); signal.removeEventListener("abort", abort); throw error; }
    void (async () => {
      try {
        controller.signal.throwIfAborted();
        task.result = await options.execute(controller.signal);
        const failed = task.result && typeof task.result === "object" && "isError" in task.result && task.result.isError === true;
        task.status = failed ? "failed" : "succeeded";
      } catch (error) {
        task.status = controller.signal.aborted ? "cancelled" : "failed";
        task.error = error instanceof Error ? error.message : String(error);
      }
      try { await save(task); }
      catch (error) { console.error("MCP 任务结果保存失败", taskId, error); }
      finally { active.delete(taskId); signal.removeEventListener("abort", abort); }
    })();
    return { ...task };
  })();
  starting.set(taskId, initialization);
  try { return visible(await initialization); }
  finally { if (starting.get(taskId) === initialization) starting.delete(taskId); }
}

export async function getMcpTask(directory: string, taskId: string, cancel = false) {
  await starting.get(taskId);
  const task = await read(taskId);
  if (!task || task.directory !== directory) throw Object.assign(new Error("当前工作区没有此任务"), { status: 404 });
  if (task.status === "running" && !active.has(taskId)) {
    task.status = "interrupted";
    task.error = "执行进程已结束，远端状态未知，请核对原任务，勿重新提交";
    await save(task);
  }
  if (cancel) active.get(taskId)?.abort(new Error("用户请求停止 MCP 任务"));
  return { ...visible(task), ...(cancel ? { cancellationRequested: active.has(taskId) } : {}) };
}
