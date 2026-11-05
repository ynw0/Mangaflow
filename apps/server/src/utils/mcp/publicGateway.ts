import { createServer } from "node:http";
import type { Express, Request } from "express";
import { z } from "zod";
import conf from "@/utils/conf";
import { markPublicRequest } from "@/lib/accessToken";
import { oauthOwnerToken } from "@/utils/mcp/oauth";

export function readPublicAccess() {
  return publicAccessSchema.parse(conf.get("mcpTunnel.publicAccess", { mcp: true, management: false, files: false, api: false }));
}

function accessGroup(path: string): keyof ReturnType<typeof readPublicAccess> {
  if (/^\/mcp\/?$/.test(path) || /^\/api\/oauth\//.test(path) || /^\/\.well-known\/oauth-/.test(path)) return "mcp";
  // 文件路由先于其他 API 分类，禁止由宽泛的 API 开关覆盖文件开关。
  if (/^\/api\/(workspaces\/files|assets)(?:\/|$)/.test(path)) return "files";
  if (/^\/api\/auth\//.test(path)) return "management";
  return /^\/(api|a2a)(?:\/|$)/.test(path) ? "api" : "management";
}

export async function openPublicGateway(app: Express) {
  const server = createServer((req, res) => {
    let path: string;
    try { path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname); }
    catch { res.writeHead(400).end(); return; }
    try {
      const token = oauthOwnerToken();
      if (!token) { res.writeHead(503).end("公网访问需要管理凭证"); return; }
      const access = readPublicAccess();
      // Express 默认不区分路由大小写，分类必须使用相同规则。
      if (!access[accessGroup(path.toLowerCase())]) { res.writeHead(403).end("此公网入口未开放"); return; }
      markPublicRequest(req as Request, token);
      app(req, res);
    } catch (error) { console.error("公网入口配置无效", error); res.writeHead(503).end("公网入口配置无效"); }
  });
  server.timeout = 120_000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("公网转发入口未就绪");
  return { server, target: `http://127.0.0.1:${address.port}` };
}

export const publicAccessSchema = z.object({ mcp: z.boolean(), management: z.boolean(), files: z.boolean(), api: z.boolean() });
