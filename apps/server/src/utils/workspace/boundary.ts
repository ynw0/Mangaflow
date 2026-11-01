// 工作区外的文件操作：系统目录直接拒绝；其余询问用户。全自动只自动放行低风险的读取和写入。
import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, realpath } from "@toonflow/file";
import { dirname, parse, relative, resolve } from "node:path";
import type { QuestionAnswer, QuestionRequest } from "@toonflow/tools-scaffold/runtime";
import { getConfiguredModel, listAiModels } from "@/utils/ai";
import { readProduction } from "@/utils/production/config";
import { isWithin } from "@/utils/workspace/files";

export type BoundaryAction = "read" | "write" | "delete";

type BoundaryStore = {
  grants: Set<string>;
  cwd: string;
  ask?: (request: QuestionRequest) => Promise<QuestionAnswer>;
  signal?: AbortSignal;
};

const storage = new AsyncLocalStorage<BoundaryStore>();

function grantKey(path: string, action: BoundaryAction) {
  const normalized = resolve(path);
  return `${action}\0${process.platform === "win32" ? normalized.toLowerCase() : normalized}`;
}

function samePath(left: string, right: string) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function systemRoots(path: string) {
  const roots = new Set<string>();
  const add = (value?: string) => {
    if (!value?.trim()) return;
    roots.add(resolve(value));
  };
  add(process.env.SystemRoot);
  add(process.env.windir);
  add(process.env.ProgramFiles);
  add(process.env["ProgramFiles(x86)"]);
  add(process.env.ProgramData);
  const drive = parse(resolve(path)).root;
  if (process.platform === "win32") {
    for (const name of ["Windows", "Program Files", "Program Files (x86)", "ProgramData", "System Volume Information"]) {
      add(`${drive}${name}`);
    }
  } else {
    for (const name of ["/bin", "/sbin", "/usr", "/etc", "/boot", "/System", "/Library", "/dev", "/proc", "/sys", "/private/etc", "/private/var"]) add(name);
  }
  return [...roots];
}

function isDriveRoot(path: string) {
  return samePath(path, parse(resolve(path)).root);
}

/** 系统目录本身、其内部，以及会连带删到系统目录的上级路径。 */
export function isSystemPath(path: string) {
  const actual = resolve(path);
  return systemRoots(actual).some(root => samePath(actual, root) || isWithin(root, actual) || isWithin(actual, root));
}

function isSensitive(path: string) {
  const parts = resolve(path).split(/[\\/]/).map(part => part.toLowerCase());
  return parts.some(part => ["appdata", ".ssh", ".aws", ".gnupg", "credentials", "ntuser.dat", "cookies"].includes(part));
}

function forbidden(action: BoundaryAction, path: string) {
  if (isSystemPath(path)) return true;
  return action === "delete" && isDriveRoot(path);
}

export function boundaryGranted(path: string, action: "read" | "write") {
  const store = storage.getStore();
  if (!store) return false;
  return store.grants.has(grantKey(path, action));
}

export function runWithBoundary<T>(store: BoundaryStore, operation: () => Promise<T>) {
  return storage.run(store, operation);
}

export function createBoundaryGrants() {
  return new Set<string>();
}

async function locateActual(absolute: string) {
  const target = resolve(absolute);
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info?.isSymbolicLink()) throw Object.assign(new Error("不能通过符号链接操作文件"), { status: 403 });
  if (info) return realpath(target);
  let parent = dirname(target);
  while (!(await lstat(parent).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  }))) {
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  const parentInfo = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (parentInfo?.isSymbolicLink()) throw Object.assign(new Error("不能通过符号链接操作文件"), { status: 403 });
  const base = parentInfo ? await realpath(parent) : parent;
  return resolve(base, relative(parent, target));
}

async function judgeLowRisk(action: BoundaryAction, path: string, signal?: AbortSignal) {
  const model = listAiModels().find(item => item.protocol === "openai-completions");
  if (!model) return false;
  try {
    const configured = getConfiguredModel(model.providerId, model.modelId);
    const timeout = AbortSignal.timeout(20_000);
    const response = await fetch(`${configured.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configured.provider.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: configured.model.id,
        temperature: 0,
        max_tokens: 8,
        messages: [
          {
            role: "system",
            content: "只判断这一次文件操作是否低风险。只输出 low 或 high。low 只用于读取或写入用户自己的普通媒体、图片或文档。删除、覆盖目录、凭据、密钥、系统目录、程序目录一律 high。",
          },
          { role: "user", content: `${action} ${path}` },
        ],
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) return false;
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const word = String(body.choices?.[0]?.message?.content ?? "").trim().split(/\s+/)[0]?.replace(/[^a-z]/gi, "").toLowerCase();
    return word === "low";
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

/** 已授权则返回；否则拒绝、自动放行，或向当前对话提问。 */
export async function approveWorkspaceBoundary(action: BoundaryAction, path: string) {
  const actual = resolve(path);
  if (forbidden(action, actual)) {
    throw Object.assign(new Error(`禁止操作系统目录：${actual}`), { status: 403 });
  }
  const store = storage.getStore();
  if (!store) throw Object.assign(new Error("只能操作当前工作区内的文件"), { status: 403 });
  const key = grantKey(actual, action);
  if (store.grants.has(key)) return;
  const auto = readProduction().imageAdvanceMode === "auto";
  const eligible = auto && action !== "delete" && !isSensitive(actual) && !isDriveRoot(actual);
  const low = eligible && await judgeLowRisk(action, actual, store.signal);
  if (!low) {
    if (!store.ask) throw Object.assign(new Error("只能操作当前工作区内的文件"), { status: 403 });
    const label = action === "read" ? "读取" : action === "write" ? "写入" : "删除";
    const answer = await store.ask({
      title: "工作区外操作",
      question: `这个操作不在当前工作区里。\n工作区：${store.cwd}\n${label}：${actual}\n允许这一次吗？`,
      options: ["允许", "拒绝"],
    });
    if (answer.skipped || answer.answer.split("\n")[0] !== "允许") {
      throw Object.assign(new Error("已拒绝工作区外操作"), { status: 403 });
    }
  }
  store.grants.add(key);
}

function outsideMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message === "只能操作当前工作区内的文件" || message === "文件路径无效" || message === "FFmpeg 只能操作当前工作区内的文件";
}

/** 工作区内的路径照原错误抛出。工作区外则走授权。 */
export async function recoverOutsidePath(root: string, absolute: string, action: BoundaryAction, error: unknown) {
  if (!outsideMessage(error)) throw error;
  if (absolute.split(/[\\/]/).some(part => /[<>:"|?*\x00-\x1f]/.test(part) || (process.platform === "win32" && part !== "." && (/[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))) {
    throw error;
  }
  const actual = await locateActual(absolute);
  const rootReal = await locateActual(root).catch(() => resolve(root));
  if (isWithin(rootReal, actual)) throw error;
  await approveWorkspaceBoundary(action, actual);
  return actual;
}

export function pendingBoundary(error: unknown): { action: BoundaryAction; path: string } | undefined {
  if (!error || typeof error !== "object") return;
  const pending = error as { code?: unknown; boundaryPath?: unknown; boundaryAction?: unknown };
  if (pending.code !== "WORKSPACE_BOUNDARY" || typeof pending.boundaryPath !== "string") return;
  const action = pending.boundaryAction === "write" || pending.boundaryAction === "delete" ? pending.boundaryAction : "read";
  return { action, path: pending.boundaryPath };
}

export async function attemptBoundary<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const pending = pendingBoundary(error);
      if (!pending) throw error;
      await approveWorkspaceBoundary(pending.action, pending.path);
    }
  }
  throw Object.assign(new Error("工作区外授权过多，已停止"), { status: 403 });
}
