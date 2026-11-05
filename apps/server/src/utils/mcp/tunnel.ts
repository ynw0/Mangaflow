import type { Request } from "express";
import { z } from "zod";
import conf from "@/utils/conf";
import { isPublicRequest } from "@/lib/accessToken";
import { isLocalWorkspaceRequest } from "@/utils/workspace";
import { getMcpHostApp } from "@/utils/mcp/runtime";
import { openPublicGateway, readPublicAccess, publicAccessSchema } from "@/utils/mcp/publicGateway";
import { installTailscale, runTailscale, spawnTailscale, tailscalePath } from "@/utils/mcp/tailscale";
import { mcpSettingsSchema, oauthOwnerToken } from "@/utils/mcp/oauth";

type TunnelState = { phase: "idle" | "downloading" | "installing" | "loggingIn" | "starting" | "running" | "error";
  error?: string; authUrl?: string; publicUrl?: string; received?: number; total?: number };
let state: TunnelState = { phase: "idle" };
let controller: AbortController | undefined;
let operation: Promise<void> | undefined;
let child: Awaited<ReturnType<typeof spawnTailscale>> | undefined;
let ownedUrl: string | undefined;
let clientQuery: Promise<{ connected: boolean; clientError?: string }> | undefined;
const statusSchema = z.object({ BackendState: z.string(), AuthURL: z.string().optional(), Self: z.object({ DNSName: z.string() }).nullish() });

export function requireLocalTunnelRequest(req: Request, windowsOnly = true) {
  if ((windowsOnly && process.platform !== "win32") || isPublicRequest(req) || !isLocalWorkspaceRequest(req)) {
    throw Object.assign(new Error("隧道管理仅允许 Windows 本机页面操作"), { status: 403 });
  }
}

function clearOwnedUrl() {
  if (ownedUrl && conf.get("mcpTunnel.publicUrl") === ownedUrl) conf.set("mcpTunnel.publicUrl", "");
  ownedUrl = undefined;
}

export async function getTunnelStatus() {
  const installed = Boolean(await tailscalePath());
  if (installed && !clientQuery) {
    clientQuery = runTailscale(["status", "--json"]).then(text => ({ connected: statusSchema.parse(JSON.parse(text)).BackendState === "Running" }))
      .catch(error => ({ connected: false, clientError: error instanceof Error ? error.message : String(error) }));
    void clientQuery.finally(() => { clientQuery = undefined; });
  }
  const client = clientQuery ? await clientQuery : { connected: false };
  return { ...state, ...client, supported: process.platform === "win32",
    installed, busy: Boolean(controller), publicAccess: readPublicAccess() };
}

function begin(phase: TunnelState["phase"], action: (signal: AbortSignal) => Promise<void>) {
  if (controller) throw Object.assign(new Error("隧道正在运行或处理中，请先关闭当前任务"), { status: 409 });
  const active = new AbortController();
  controller = active;
  state = { phase };
  operation = action(active.signal).catch(error => {
    if (!active.signal.aborted && !state.error) state = { phase: "error", error: error instanceof Error ? error.message : String(error) };
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
    await installTailscale(signal, (phase, received, total) => { state = { phase, received, total }; });
    state = { phase: "idle" };
  });
}

function watchProcess(process: Awaited<ReturnType<typeof spawnTailscale>>, onText: (text: string) => void) {
  let output = "";
  return new Promise<void>((resolve, reject) => {
    const read = (chunk: Buffer) => {
      try {
        output = (output + chunk.toString("utf8")).slice(-8192);
        onText(output);
        const links = output.match(/https:\/\/login\.tailscale\.com\/[^\s"<>]+/g);
        const url = links?.at(-1)?.replace(/[),.]+$/, "");
        if (url) state.authUrl = url;
      } catch (error) { process.kill(); reject(error); }
    };
    process.stdout!.on("data", read);
    process.stderr!.on("data", read);
    process.once("error", reject);
    process.once("close", code => code === 0 ? resolve() : reject(new Error(output.trim().slice(-2000) || `Tailscale 进程退出：${code}`)));
  });
}

export function startTunnelLogin() {
  return begin("loggingIn", async signal => {
    const current = statusSchema.parse(JSON.parse(await runTailscale(["status", "--json"], signal)));
    if (current.BackendState === "Running") { state = { phase: "idle" }; return; }
    if (current.BackendState !== "NeedsLogin" && current.BackendState !== "NoState") {
      throw new Error(`Tailscale 当前状态为 ${current.BackendState}，请先在客户端确认连接状态`);
    }
    child = await spawnTailscale(["up", "--json", "--timeout=5m"], signal);
    await watchProcess(child, () => {});
    state = { phase: "idle" };
  });
}

function hasPort(value: unknown, port: string): boolean {
  if (!value || typeof value !== "object") return false;
  // Serve 的前台会话和后台配置都可能占用端口，不覆盖已有配置。
  return Object.entries(value).some(([key, item]) => key === port || key.endsWith(`:${port}`) || hasPort(item, port));
}

function hasTarget(value: unknown, target: string): boolean {
  if (typeof value === "string") return value === target || value === `${target}/`;
  return !!value && typeof value === "object" && Object.values(value).some(item => hasTarget(item, target));
}

export function startPublicTunnel() {
  return begin("starting", async signal => {
    const settings = mcpSettingsSchema.parse(conf.get("settings", {}).mcp ?? {});
    if (readPublicAccess().mcp && !settings.enabled) throw new Error("请先开启 MCP，或关闭 MCP 公网入口");
    const current = statusSchema.parse(JSON.parse(await runTailscale(["status", "--json"], signal)));
    if (current.BackendState !== "Running") throw new Error("请先完成 Tailscale 登录并连接");
    const dnsName = current.Self?.DNSName.replace(/\.$/, "");
    if (!dnsName || !/^[a-z0-9.-]+\.ts\.net$/i.test(dnsName)) throw new Error("未取得 Tailscale HTTPS 域名");
    const existing = JSON.parse(await runTailscale(["funnel", "status", "--json"], signal));
    if (hasPort(existing, "8443")) throw new Error("Tailscale 的 8443 端口已有配置，未进行覆盖");
    if (!conf.get("mcpTunnel.token")) conf.set("mcpTunnel.token", oauthOwnerToken() || crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""));
    const gateway = await openPublicGateway(getMcpHostApp());
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      child = await spawnTailscale(["funnel", "--https=8443", gateway.target], signal);
      const running = child;
      let checking = false;
      // ACT: 每五秒核对一次真实状态；客户端断开或域名改变时关闭本次隧道，不自动重连。
      timer = setInterval(() => {
        if (checking || signal.aborted) return;
        checking = true;
        void Promise.all([runTailscale(["status", "--json"], signal), runTailscale(["funnel", "status", "--json"], signal)]).then(([text, funnel]) => {
          const latest = statusSchema.parse(JSON.parse(text));
          if (latest.BackendState !== "Running" || latest.Self?.DNSName.replace(/\.$/, "") !== dnsName) throw new Error("Tailscale 连接或域名已变化，请重新开启隧道");
          if (state.phase === "running" && !hasTarget(JSON.parse(funnel), gateway.target)) throw new Error("本应用的公网转发配置已变化，隧道已关闭");
        }).catch(error => {
          if (!signal.aborted) { state = { phase: "error", error: error instanceof Error ? error.message : String(error) }; running.kill(); }
        }).finally(() => { checking = false; });
      }, 5000);
      await watchProcess(running, output => {
        if (state.phase !== "starting" || !output.includes("Available on the internet")) return;
        ownedUrl = `https://${dnsName}:8443`;
        conf.set("mcpTunnel", { managed: true, publicUrl: ownedUrl, token: conf.get("mcpTunnel.token", ""), publicAccess: readPublicAccess() });
        state = { phase: "running", publicUrl: ownedUrl };
      });
      if (!signal.aborted) throw new Error("公网隧道已退出");
    } finally {
      clearInterval(timer);
      gateway.server.closeAllConnections();
      await new Promise<void>(resolve => gateway.server.close(() => resolve()));
    }
  });
}

export async function stopPublicTunnel() {
  if (state.phase === "installing") throw Object.assign(new Error("安装过程中请等待系统安装完成"), { status: 409 });
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
  if (state.phase !== "installing") await operation;
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
