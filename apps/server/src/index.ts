import { resolve } from "node:path";
import { createApp } from "./app";
import config from "../../../electrobun.config";

const startTime = Date.now();
const realPort = 3000;
// 源码位于 apps/server/src，生产构建位于 build/server，均从文件位置定位根目录。
const fromSource = import.meta.path.endsWith(".ts");
const appDirectory = resolve(import.meta.dirname, fromSource ? "../../.." : "../..");
const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(appDirectory, "data");
const app = await createApp({
  webRoot: resolve(appDirectory, "build/web"),
  appVersion: config.app.version,
  dataDirectory,
  toolsRoot: resolve(appDirectory, "build/tools"),
  nodesRoot: resolve(appDirectory, "build/nodes"),
  extRoot: resolve(appDirectory, "build/ext"),
  // ACT: 暂不安装内置团队，随团队打包一同恢复。
  // agentsRoot: resolve(appDirectory, "build/agents"),
  providersRoot: resolve(appDirectory, fromSource ? "packages/providers/src" : "build/providers"),
  skillsRoot: resolve(appDirectory, fromSource ? "packages/skills" : "build/skills"),
});
const { initializeMcpRuntime } = await import("./utils/mcp/runtime");
const { startMobileLinkRuntime } = await import("./utils/mobileLink");
// 默认只监听本机。容器内需要由端口映射转发，显式设置 TOONFLOW_HOST=0.0.0.0。
const listenHost = process.env.TOONFLOW_HOST?.trim() || "127.0.0.1";
if (!/^[A-Za-z0-9._:-]+$/.test(listenHost) || listenHost.length > 253) throw new Error("TOONFLOW_HOST 必须是主机名或 IP");
const server = app.listen(realPort, listenHost, async () => {
  await initializeMcpRuntime(app, `http://127.0.0.1:${realPort}`, resolve(appDirectory, fromSource ? "packages/mcp/src/stdio.ts" : "build/mcp/stdio.js"));
  await startMobileLinkRuntime(app).catch(error => console.error("设备互联启动失败：", error));
  console.log(`[服务启动成功]: http://${listenHost}:${realPort}`);
  console.log(`[启动耗时]: ${(Date.now() - startTime).toFixed(2)}ms`);
});
// ACT: 套接字不设空闲超时。出图、出视频和 SSE 会占住连接，中间只有保活写入；空闲超时会在远端仍在跑时断开。
server.timeout = 0;
server.headersTimeout = 60_000;
server.requestTimeout = 5 * 60_000;
