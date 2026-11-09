import type { Request } from "express";
import type { z } from "zod";
import conf from "@/utils/conf";
import { isPublicRequest } from "@/lib/accessToken";
import { isLocalWorkspaceRequest } from "@/utils/workspace";
import { getMcpHostApp } from "@/utils/mcp/runtime";
import { openPublicGateway, readPublicAccess, publicAccessSchema } from "@/utils/mcp/publicGateway";
import { appendCloudflareLog, cloudflarePath, flushCloudflareLog, installCloudflare, spawnCloudflare } from "@/utils/mcp/cloudflare";
import { mcpSettingsSchema, oauthOwnerToken } from "@/utils/mcp/oauth";

type TunnelState = { phase: "idle" | "downloading" | "starting" | "running" | "reconnecting" | "error";
  error?: string; publicUrl?: string; received?: number; total?: number };
let state: TunnelState = { phase: "idle" };
let controller: AbortController | undefined;
let operation: Promise<void> | undefined;
let child: Awaited<ReturnType<typeof spawnCloudflare>> | undefined;
let ownedUrl: string | undefined;

export function requireLocalTunnelRequest(req: Request, windowsOnly = true) {
  if ((windowsOnly && (process.platform !== "win32" || process.arch !== "x64")) || isPublicRequest(req) || !isLocalWorkspaceRequest(req)) {
    throw Object.assign(new Error("隧道管理仅允许 Windows x64 本机页面操作"), { status: 403 });
  }
}
function clearOwnedUrl() {
  if (ownedUrl && conf.get("mcpTunnel.publicUrl") === ownedUrl) conf.set("mcpTunnel.publicUrl", "");
  ownedUrl = undefined;
}
export async function getTunnelStatus() {
  return { ...state, provider: "trycloudflare", supported: process.platform === "win32" && process.arch === "x64",
    installed: Boolean(await cloudflarePath()), busy: Boolean(controller), publicAccess: readPublicAccess() };
}
function begin(phase: TunnelState["phase"], action: (signal: AbortSignal) => Promise<void>) {
  if (controller) throw Object.assign(new Error("隧道正在运行或处理中，请先关闭当前任务"), { status: 409 });
  const active = new AbortController();
  controller = active;
  state = { phase };
  operation = action(active.signal).catch(error => {
    if (!active.signal.aborted) state = { phase: "error", error: error instanceof Error ? error.message : String(error) };
  }).finally(() => {
    let cleanupFailed = false;
    try { clearOwnedUrl(); }
    catch (error) { cleanupFailed = true; state = { phase: "error", error: error instanceof Error ? error.message : String(error) }; }
    child = undefined;
    if (controller === active) controller = undefined;
    if (active.signal.aborted && !cleanupFailed) state = { phase: "idle" };
  });
  return { ...state };
}
export function startTunnelInstall() {
  return begin("downloading", async signal => {
    await installCloudflare(signal, (received, total) => { state = { phase: "downloading", received, total }; });
    state = { phase: "idle" };
  });
}
export function startPublicTunnel() {
  return begin("starting", async signal => {
    const settings = mcpSettingsSchema.parse(conf.get("settings", {}).mcp ?? {});
    if (readPublicAccess().mcp && !settings.enabled) throw new Error("请先开启 MCP，或关闭 MCP 公网入口");
    if (!conf.get("mcpTunnel.token")) conf.set("mcpTunnel.token", oauthOwnerToken() || crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""));
    const gateway = await openPublicGateway(getMcpHostApp());
    try {
      void appendCloudflareLog("lifecycle", "正在启动 TryCloudflare 隧道");
      child = await spawnCloudflare(gateway.target, signal);
      const running = child;
      await new Promise<void>((resolve, reject) => {
        let output = "";
        let allocatedUrl: string | undefined;
        let readyUrl: string | undefined;
        let checking = false;
        const failStartup = (error: Error) => {
          clearTimeout(timer);
          clearInterval(monitor);
          void appendCloudflareLog("lifecycle", "TryCloudflare 首次连接失败：" + error.message);
          running.kill();
          reject(error);
        };
        const timer = setTimeout(() => { failStartup(new Error("TryCloudflare 首次连接超时，请检查网络后重新开启")); }, 90_000);
        // 以官方 /ready 状态判断真实连接，不把仅分配域名当成公网可用。
        const monitor = setInterval(() => {
          if (!readyUrl || !allocatedUrl || checking || signal.aborted) return;
          checking = true;
          void fetch(readyUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) }).then(async response => {
            await response.body?.cancel();
            if (signal.aborted) return;
            if (!response.ok) {
              if (state.phase === "running") {
                state = { phase: "reconnecting", publicUrl: ownedUrl };
                void appendCloudflareLog("readiness", "/ready 返回 HTTP " + response.status + "；保留 cloudflared 进程和公网地址");
              }
              return;
            }
            if (state.phase === "starting") {
              ownedUrl = allocatedUrl;
              conf.set("mcpTunnel", { managed: true, publicUrl: ownedUrl!, token: conf.get("mcpTunnel.token", ""), publicAccess: readPublicAccess() });
              state = { phase: "running", publicUrl: ownedUrl };
              void appendCloudflareLog("readiness", "TryCloudflare 公网连接已建立");
              clearTimeout(timer);
            } else if (state.phase === "reconnecting") {
              state = { phase: "running", publicUrl: ownedUrl ?? allocatedUrl };
              void appendCloudflareLog("readiness", "TryCloudflare 公网连接已自动恢复");
            }
          }).catch(error => {
            if (!signal.aborted && state.phase === "running") {
              state = { phase: "reconnecting", publicUrl: ownedUrl };
              void appendCloudflareLog("readiness", "/ready 检查失败；保留 cloudflared 进程：" + (error instanceof Error ? error.message : String(error)));
            }
          }).finally(() => { checking = false; });
        }, 2000);
        const read = (source: "stdout" | "stderr") => (chunk: Buffer) => {
          const content = chunk.toString("utf8");
          output = (output + content).slice(-16384);
          void appendCloudflareLog(source, content);
          try {
            const matches = [...output.matchAll(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/gi)];
            const match = matches.reverse().find(item => !["api.trycloudflare.com", "www.trycloudflare.com"].includes(new URL(item[0]).hostname));
            if (match) allocatedUrl = new URL(match[0]).origin;
            const metrics = /127\.0\.0\.1:([1-9]\d{0,4})\/metrics/.exec(output);
            if (metrics && Number(metrics[1]) <= 65535) readyUrl = `http://127.0.0.1:${metrics[1]}/ready`;
          } catch (error) { void appendCloudflareLog("parser", "读取 cloudflared 状态输出失败：" + (error instanceof Error ? error.message : String(error))); }
        };
        running.stdout!.on("data", read("stdout"));
        running.stderr!.on("data", read("stderr"));
        running.once("error", error => {
          void appendCloudflareLog("process", "cloudflared 进程错误：" + error.message);
          if (running.pid === undefined) {
            clearTimeout(timer);
            clearInterval(monitor);
            reject(error);
          }
        });
        running.once("close", code => {
          clearTimeout(timer);
          clearInterval(monitor);
          void appendCloudflareLog("lifecycle", "cloudflared 进程退出，code=" + code);
          if (signal.aborted) resolve();
          else reject(new Error("TryCloudflare 进程已退出（" + code + "）：" + output.trim().slice(-1500)));
        });
      }).finally(() => flushCloudflareLog());
    } finally {
      gateway.server.closeAllConnections();
      await new Promise<void>(resolve => gateway.server.close(() => resolve()));
    }
  });
}
export async function stopPublicTunnel() {
  if (controller) void appendCloudflareLog("lifecycle", "用户请求关闭 TryCloudflare 隧道");
  controller?.abort();
  await operation;
  clearOwnedUrl();
  state = { phase: "idle" };
  return getTunnelStatus();
}
export async function stopTunnelOnHostClose() {
  controller?.abort();
  child?.kill();
  clearOwnedUrl();
  await operation;
}
export function saveTunnelAccess(input: z.infer<typeof publicAccessSchema>) {
  conf.set("mcpTunnel.publicAccess", publicAccessSchema.parse(input));
  return readPublicAccess();
}
export function useManualPublicUrl() {
  if (controller) throw Object.assign(new Error("请先关闭当前隧道再修改公网地址"), { status: 409 });
  conf.set("mcpTunnel.managed", false);
}
process.once("exit", () => { child?.kill(); clearOwnedUrl(); });
