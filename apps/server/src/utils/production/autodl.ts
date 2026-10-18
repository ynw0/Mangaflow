// AutoDL 实例：查询状态、开关机。生成前开机由制作配置里的开关决定。
import { fail, readProduction } from "@/utils/production/config";

const offStates = new Set(["shutdown", "stopped", "off", "", "shutdown_by_starting_error"]);

type InstanceRow = { uuid?: string; name?: string; status?: string };

function endpoint(path: string, query?: Record<string, string>) {
  const config = readProduction();
  if (!config.autodlToken) fail("请先填写 AutoDL Token");
  const url = new URL(path, config.autodlBaseUrl.endsWith("/") ? config.autodlBaseUrl : `${config.autodlBaseUrl}/`);
  if (query) Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return { url, token: config.autodlToken };
}

async function autodlRequest(method: "GET" | "POST", path: string, payload: Record<string, unknown> = {}, signal?: AbortSignal) {
  const { url, token } = endpoint(path, method === "GET" ? Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value)])) : undefined);
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

export async function autodlStatus(signal?: AbortSignal) {
  const config = readProduction();
  if (!config.autodlInstanceUuid) fail("请先填写 AutoDL 实例 UUID");
  const data = await autodlRequest("GET", "/api/v1/adl_dev/dev/instance/pro/status", { instance_uuid: config.autodlInstanceUuid }, signal);
  return { status: String(data ?? ""), instanceUuid: config.autodlInstanceUuid };
}

export async function autodlPower(action: "on" | "off", signal?: AbortSignal) {
  const config = readProduction();
  if (!config.autodlInstanceUuid) fail("请先填写 AutoDL 实例 UUID");
  if (action === "off") {
    await autodlRequest("POST", "/api/v1/adl_dev/dev/instance/pro/power_off", { instance_uuid: config.autodlInstanceUuid }, signal);
    return { ok: true as const };
  }
  const body: Record<string, unknown> = { instance_uuid: config.autodlInstanceUuid, payload: "gpu" };
  if (config.autodlStartCommand) body.start_command = config.autodlStartCommand;
  await autodlRequest("POST", "/api/v1/adl_dev/dev/instance/pro/power_on", body, signal);
  return { ok: true as const };
}

export async function autodlSnapshot(signal?: AbortSignal) {
  const config = readProduction();
  if (!config.autodlInstanceUuid) fail("请先填写 AutoDL 实例 UUID");
  const data = await autodlRequest("GET", "/api/v1/adl_dev/dev/instance/pro/snapshot", { instance_uuid: config.autodlInstanceUuid }, signal);
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("AutoDL snapshot 返回格式异常", 502);
  return data as Record<string, unknown>;
}

export async function resolveComfyBaseUrl(signal?: AbortSignal) {
  const config = readProduction();
  if (config.videoHost === "local") return config.localComfyuiBaseUrl;
  const override = config.comfyuiBaseUrl;
  const hasInstance = Boolean(config.autodlToken && config.autodlInstanceUuid);
  if (hasInstance && (config.autodlEnsureRunning || !override)) await ensureAutodlRunning(signal);
  if (override) return override;
  if (!hasInstance) fail("出视频选了 AutoDL 上的 ComfyUI。请填写 Token 和实例 UUID，或改用本机 ComfyUI。");
  const snapshot = await autodlSnapshot(signal);
  const domain = snapshot[config.comfyuiServiceField];
  if (typeof domain !== "string" || !domain.trim()) fail(`这台 AutoDL 实例没有 ${config.comfyuiServiceField}，远程 ComfyUI 还没暴露出来`, 502);
  const host = domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `${config.comfyuiScheme}://${host}`;
}

export async function ensureAutodlRunning(signal?: AbortSignal) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const { status } = await autodlStatus(signal);
    if (status === "running") return;
    if (offStates.has(status)) await autodlPower("on", signal);
    await new Promise(resolveWait => setTimeout(resolveWait, 8000));
  }
  fail("AutoDL 在 15 分钟内没有进入 running", 504);
}
