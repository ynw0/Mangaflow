// AutoDL 实例：查询状态、开关机。生成前开机由制作配置里的开关决定。
import type { VideoExecution } from "@toonflow/tools-scaffold/runtime";
import { fail, readProduction, type ComfyHost, type ProductionConfig } from "@/utils/production/config";

const offStates = new Set(["shutdown", "stopped", "off", "", "shutdown_by_starting_error"]);

type InstanceRow = { uuid?: string; name?: string; status?: string };
type ComfyTarget = { baseUrl: string; autodlInstanceUuid?: string; autodlBaseUrl?: string };
export type TrackedVideoExecution = VideoExecution & { target?: ComfyTarget };

function endpoint(config: ProductionConfig, path: string, query?: Record<string, string>) {
  if (!config.autodlToken) fail("请先填写 AutoDL Token");
  const url = new URL(path, config.autodlBaseUrl.endsWith("/") ? config.autodlBaseUrl : `${config.autodlBaseUrl}/`);
  if (query) Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return { url, token: config.autodlToken };
}

async function autodlRequest(method: "GET" | "POST", path: string, payload: Record<string, unknown>, signal?: AbortSignal, config = readProduction()) {
  const { url, token } = endpoint(config, path, method === "GET" ? Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value)])) : undefined);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: token,
      ...(method === "POST" ? { "Content-Type": "application/json;charset=UTF-8" } : {}),
    },
    body: method === "POST" ? JSON.stringify(payload) : undefined,
    signal,
  });
  const parsed = await response.json().catch(() => undefined) as { code?: string; data?: unknown; msg?: string } | undefined;
  if (!response.ok || parsed?.code !== "Success") fail(`AutoDL 请求失败：${parsed?.msg || response.status}`, 502);
  return parsed.data;
}

export async function listAutodlInstances(signal?: AbortSignal) {
  const rows: { uuid: string; name: string; status: string }[] = [];
  let page = 1;
  while (page < 20) {
    const data = await autodlRequest("POST", "/api/v1/adl_dev/dev/instance/pro/list", { page_index: page, page_size: 100 }, signal);
    const list = data && typeof data === "object" && Array.isArray((data as { list?: unknown }).list)
      ? (data as { list: InstanceRow[]; max_page?: number }).list
      : [];
    list.forEach(row => {
      if (row && typeof row === "object") rows.push({ uuid: String(row.uuid ?? ""), name: String(row.name ?? ""), status: String(row.status ?? "") });
    });
    const maxPage = data && typeof data === "object" ? Number((data as { max_page?: number }).max_page ?? page) : page;
    if (page >= maxPage || !list.length) break;
    page += 1;
  }
  return rows.filter(row => row.uuid);
}

export async function autodlStatus(signal?: AbortSignal, config = readProduction()) {
  if (!config.autodlInstanceUuid) fail("请先填写 AutoDL 实例 UUID");
  const data = await autodlRequest("GET", "/api/v1/adl_dev/dev/instance/pro/status", { instance_uuid: config.autodlInstanceUuid }, signal, config);
  return { status: String(data ?? ""), instanceUuid: config.autodlInstanceUuid };
}

export async function autodlPower(action: "on" | "off", signal?: AbortSignal, config = readProduction()) {
  if (!config.autodlInstanceUuid) fail("请先填写 AutoDL 实例 UUID");
  if (action === "off") {
    await autodlRequest("POST", "/api/v1/adl_dev/dev/instance/pro/power_off", { instance_uuid: config.autodlInstanceUuid }, signal, config);
    return { ok: true as const };
  }
  const body: Record<string, unknown> = { instance_uuid: config.autodlInstanceUuid, payload: "gpu" };
  if (config.autodlStartCommand) body.start_command = config.autodlStartCommand;
  await autodlRequest("POST", "/api/v1/adl_dev/dev/instance/pro/power_on", body, signal, config);
  return { ok: true as const };
}

export async function autodlSnapshot(signal?: AbortSignal, config = readProduction()) {
  if (!config.autodlInstanceUuid) fail("请先填写 AutoDL 实例 UUID");
  const data = await autodlRequest("GET", "/api/v1/adl_dev/dev/instance/pro/snapshot", { instance_uuid: config.autodlInstanceUuid }, signal, config);
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("AutoDL snapshot 返回格式异常", 502);
  return data as Record<string, unknown>;
}

export async function resolveComfyBaseUrl(signal?: AbortSignal, host?: ComfyHost) {
  return (await resolveComfyTarget(signal, host)).baseUrl;
}

export async function resolveComfyTarget(signal?: AbortSignal, host?: ComfyHost): Promise<ComfyTarget> {
  const config = readProduction();
  if ((host ?? config.videoHost) === "local") return { baseUrl: config.localComfyuiBaseUrl };
  const override = config.comfyuiBaseUrl;
  const hasInstance = Boolean(config.autodlToken && config.autodlInstanceUuid);
  const instance = config.autodlInstanceUuid ? { autodlInstanceUuid: config.autodlInstanceUuid, autodlBaseUrl: config.autodlBaseUrl } : {};
  if (hasInstance && (config.autodlEnsureRunning || !override)) await ensureAutodlRunning(config, signal);
  if (override) return { ...instance, baseUrl: override };
  if (!hasInstance) fail("请选择 AutoDL 实例并填写 Token，或填写该实例的 ComfyUI 地址。");
  const snapshot = await autodlSnapshot(signal, config);
  const domain = snapshot[config.comfyuiServiceField];
  if (typeof domain !== "string" || !domain.trim()) fail(`这台 AutoDL 实例没有 ${config.comfyuiServiceField}，远程 ComfyUI 还没暴露出来`, 502);
  const serviceHost = domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return { ...instance, baseUrl: `${config.comfyuiScheme}://${serviceHost}` };
}

// 恢复与取消只联系提交时记录的地址，不读取当前目标，也不启动 GPU。
export function resolveRecordedComfyBaseUrl(execution: Omit<TrackedVideoExecution, "promptId">) {
  const { host, target } = execution;
  if ((host !== "local" && host !== "autodl") || !target?.baseUrl || !/^https?:\/\//i.test(target.baseUrl)) {
    fail("任务未记录原 ComfyUI 地址，无法安全操作；请到原实例核对队列或取回成片", 409);
  }
  return target.baseUrl;
}

const boots = new Map<string, Promise<void>>();

async function waitUntilRunning(config: ProductionConfig) {
  const deadline = Date.now() + 15 * 60_000;
  let started = false;
  while (Date.now() < deadline) {
    const { status } = await autodlStatus(undefined, config);
    if (status === "running") return;
    if (!started && offStates.has(status)) {
      await autodlPower("on", undefined, config);
      started = true;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 8000));
  }
  fail("AutoDL 在 15 分钟内没有进入 running", 504);
}

function ensureAutodlRunning(config: ProductionConfig, signal?: AbortSignal) {
  const id = JSON.stringify([config.autodlBaseUrl, config.autodlInstanceUuid]);
  let boot = boots.get(id);
  if (!boot) {
    boot = waitUntilRunning(config).finally(() => {
      if (boots.get(id) === boot) boots.delete(id);
    });
    boots.set(id, boot);
  }
  if (!signal) return boot;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    boot!.then(value => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}
