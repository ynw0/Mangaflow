import { lstat } from "@toonflow/file";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { getRuntimePlatform } from "@/lib/platform";

const router = Router();

// 只打开素材库内的文件夹，让资源管理器进入该目录。
export default router.post("/", validateFields({ path: z.string().min(1).max(4096) }), async (req, res) => {
  const desktop = u.desktop.getDesktopRuntime(req);
  const native = !!desktop || getRuntimePlatform().nativeDevelopment;
  if (!native || !u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("仅支持桌面客户端或本机开发页面打开文件所在位置"), { status: 403 });
  const root = await u.assets.getAssetsDirectory();
  const { directory, path } = await u.workspaceFile.resolveWorkspacePath(root, req.body.path);
  u.workspaceFile.protectWorkspaceRoot(directory, path);
  if (!(await lstat(path)).isDirectory()) throw Object.assign(new Error("只能在文件资源管理器中打开文件夹"), { status: 400 });
  // 桌面进程里 spawn explorer 会隐藏窗口，并卡住服务，画布和设置请求不再返回。
  if (desktop) {
    if (!desktop.openPath(path)) throw Object.assign(new Error("无法在文件资源管理器中打开该文件夹"), { status: 500 });
  } else {
    const child = process.platform === "win32"
      ? spawn(resolve(process.env.WINDIR ?? "C:\\Windows", "explorer.exe"), [path], { detached: true, stdio: "ignore" })
      : process.platform === "darwin"
        ? spawn("/usr/bin/open", [path], { detached: true, stdio: "ignore" })
        : spawn("xdg-open", [path], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  }
  res.json(success());
});
