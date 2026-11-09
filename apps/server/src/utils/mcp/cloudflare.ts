import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createWriteStream, mkdir, readFile, stat, unlink, writeAtomic } from "@toonflow/file";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import conf from "@/utils/conf";

const assetName = "cloudflared-windows-amd64.exe";
const directory = () => join(dirname(conf.path), "cloudflared");
const binaryPath = () => join(directory(), "cloudflared.exe");
export async function cloudflarePath() {
  if (process.platform !== "win32" || process.arch !== "x64") return null;
  const info = await stat(binaryPath()).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  return info?.isFile() ? binaryPath() : null;
}
export async function installCloudflare(signal: AbortSignal, progress: (received: number, total?: number) => void) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("内置 cloudflared 当前支持 Windows x64");
  if (await cloudflarePath()) throw new Error("cloudflared 已下载");
  const release = await fetch("https://api.github.com/repos/cloudflare/cloudflared/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "MangaFlow" }, signal,
  });
  if (!release.ok) throw new Error(`获取 Cloudflare 官方版本失败：HTTP ${release.status}`);
  const metadata = await release.json() as { assets?: { name: string; browser_download_url: string; digest?: string }[] };
  const asset = metadata.assets?.find(item => item.name === assetName);
  if (!asset || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? "")) throw new Error("官方发行缺少 Windows 客户端或 SHA256 摘要，未下载安装");
  const address = new URL(asset.browser_download_url);
  if (address.protocol !== "https:" || address.hostname !== "github.com" || !address.pathname.startsWith("/cloudflare/cloudflared/releases/download/")) throw new Error("cloudflared 官方下载地址无效");
  await mkdir(directory(), { recursive: true });
  const temporaryPath = join(directory(), `download${crypto.randomUUID().replaceAll("-", "")}.tmp`);
  try {
    const response = await fetch(address, { signal });
    if (!response.ok || !response.body) throw new Error(`下载 cloudflared 失败：HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || undefined;
    let received = 0;
    const digest = createHash("sha256");
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > 150 * 1024 * 1024) return callback(new Error("cloudflared 下载超过 150 MB"));
      digest.update(chunk);
      progress(received, total);
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), counter, createWriteStream(temporaryPath, { flags: "wx" }), { signal });
    if (!received || digest.digest("hex") !== asset.digest!.slice(7).toLowerCase()) throw new Error("cloudflared 下载摘要不匹配，未安装");
    signal.throwIfAborted();
    // 只校验官方二进制发行包；完整文件才发布到可执行路径。
    await writeAtomic(binaryPath(), await readFile(temporaryPath), { exclusive: true, mode: 0o700 });
  } finally { await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
}
export async function spawnCloudflare(target: string, signal: AbortSignal) {
  const path = await cloudflarePath();
  if (!path) throw new Error("请先下载 cloudflared");
  const configPath = join(directory(), "quickTunnel.yaml");
  // 隔离应用配置，不读取或改写用户已有的命名隧道配置。
  await writeAtomic(configPath, "{}\n");
  return spawn(path, ["tunnel", "--config", configPath, "--no-autoupdate", "--metrics", "127.0.0.1:0", "--url", target], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal,
  });
}
