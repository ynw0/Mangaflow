import { Router } from "express";
import u from "@/utils";
import { oauthEndpoint, validateOauth } from "@/lib/oauthEndpoint";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export default Router().get("/", validateOauth(u.mcpOauth.authorizeSchema.shape, "query"), oauthEndpoint(async (req, res) => {
  const pending = await u.mcpOauth.beginAuthorization(u.mcpOauth.authorizeSchema.parse(req.query));
  res.set("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  // 授权页只展示已注册客户端，管理员令牌由用户主动提交，不放入 URL 或返回正文。
  res.type("html").send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MangaFlow 授权</title><main><h1>授权 MCP 访问</h1><p>${escapeHtml(pending.clientName)}</p><p>允许此客户端调用当前已开启的 MCP 工具。</p><p>回调地址：${escapeHtml(pending.redirectUri)}</p><form method="post" action="/api/oauth/approve"><input type="hidden" name="id" value="${pending.id}"><label>管理员访问令牌 <input type="password" name="token" required autocomplete="off" maxlength="256"></label><p><button name="decision" value="approve">授权</button> <button name="decision" value="deny">拒绝</button></p></form></main></html>`);
}));
