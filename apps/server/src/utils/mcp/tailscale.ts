import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { createWriteStream, mkdir, stat, unlink } from "@toonflow/file";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import conf from "@/utils/conf";

const execute = promisify(execFile);
const installerUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-1.104.5.exe";

export async function tailscalePath() {
  if (process.platform !== "win32") return null;
  const programFiles = process.env.ProgramFiles;
  if (!programFiles) throw new Error("无法定位 Windows 程序目录");
  const path = join(programFiles, "Tailscale", "tailscale.exe");
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  return info?.isFile() ? path : null;
}

export async function runTailscale(args: string[], signal?: AbortSignal) {
  const path = await tailscalePath();
  if (!path) throw new Error("请先安装 Tailscale");
  return (await execute(path, args, { encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, signal })).stdout;
}

export async function spawnTailscale(args: string[], signal: AbortSignal) {
  const path = await tailscalePath();
  if (!path) throw new Error("请先安装 Tailscale");
  return spawn(path, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal });
}

export async function installTailscale(signal: AbortSignal, progress: (phase: "downloading" | "installing", received: number, total?: number) => void) {
  if (process.platform !== "win32") throw new Error("当前内置安装仅支持 Windows");
  if (await tailscalePath()) throw new Error("Tailscale 已安装");
  const directory = join(dirname(conf.path), "tunnel");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `tailscaleInstaller${crypto.randomUUID().replaceAll("-", "")}.exe`);
  try {
    const response = await fetch(installerUrl, { signal, redirect: "error" });
    if (!response.ok || !response.body) throw new Error(`下载安装包失败：HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || undefined;
    let received = 0;
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > 150 * 1024 * 1024) return callback(new Error("安装包超过 150 MB"));
      progress("downloading", received, total);
      callback(null, chunk);
    } });
    progress("downloading", 0, total);
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), counter, createWriteStream(path, { flags: "wx" }), { signal });
    signal.throwIfAborted();
    progress("installing", received, total);
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot) throw new Error("无法定位 Windows 系统目录");
    // 仅执行官方签名有效且发布者为 Tailscale 的安装包，路径通过环境变量传递。
    const script = `$ErrorActionPreference = 'Stop'; $signature = Get-AuthenticodeSignature -LiteralPath $env:MANGAFLOW_TUNNEL_INSTALLER; if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:CN|O)=Tailscale (?:Inc\\.?|Incorporated)(?:,|$)') { throw 'Tailscale 安装包签名无效' }; $installer = Start-Process -FilePath $env:MANGAFLOW_TUNNEL_INSTALLER -ArgumentList '/quiet','/norestart' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if ($installer.ExitCode -notin 0,3010) { throw ('安装失败：' + $installer.ExitCode) }`;
    await execute(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true, timeout: 15 * 60_000, maxBuffer: 1024 * 1024, env: { ...process.env, MANGAFLOW_TUNNEL_INSTALLER: path },
    });
    if (!await tailscalePath()) throw new Error("安装结束但未找到 Tailscale，请检查系统安装提示");
  } finally { await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
}
