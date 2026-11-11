import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Request } from "express";
import conf from "@/utils/conf";
import { accessToken, sameToken } from "@/lib/accessToken";
import { publicMcpPermissionSchema } from "@/types/mcpPermissions";

const httpsOrigin = z.string().refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === "https:" && url.origin === value && !url.username && !url.password; }
  catch { return false; }
}, "公网地址必须是 HTTPS 源地址，不包含路径或末尾斜杠");
export const mcpSettingsSchema = z.object({
  enabled: z.boolean().optional(), token: z.string().optional(), port: z.number().int().min(1).max(65535).optional(),
  authMode: z.enum(["oauth", "none"]).optional(), publicUrl: httpsOrigin.optional(),
  publicPermissions: publicMcpPermissionSchema.optional(),
  allowDirectMedia: z.boolean().optional(),
});
export function oauthOwnerToken() {
  const raw = conf.get("settings", {}).mcp as { token?: string } | undefined;
  const token = accessToken() || conf.get("mcpTunnel.token", "") || raw?.token || "";
  return /^[A-Za-z0-9._~-]{32,256}$/.test(token) ? token : "";
}
export function publicMcpSettings() {
  const raw = conf.get("settings", {}).mcp;
  const parsed = mcpSettingsSchema.parse(raw ?? {});
  return { enabled: parsed.enabled === true, authMode: parsed.authMode ?? "oauth",
    publicPermissions: parsed.publicPermissions ?? {}, allowDirectMedia: parsed.allowDirectMedia === true,
    publicUrl: conf.get("mcpTunnel.managed") === true ? conf.get("mcpTunnel.publicUrl", "") : parsed.publicUrl || process.env.TOONFLOW_PUBLIC_URL || "" };
}
export function oauthOrigin() {
  const settings = publicMcpSettings();
  if (!settings.enabled || settings.authMode !== "oauth") throw Object.assign(new Error("OAuth 未开启"), { status: 404 });
  if (!settings.publicUrl || !httpsOrigin.safeParse(settings.publicUrl).success || !oauthOwnerToken()) {
    throw Object.assign(new Error("OAuth 需要 HTTPS 公网地址和管理端访问令牌"), { status: 503 });
  }
  return settings.publicUrl;
}
export function authorizationVersion() {
  return hash(JSON.stringify([publicMcpSettings(), oauthOwnerToken()]));
}
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const secret = () => randomBytes(32).toString("base64url");
let sessionRevision = secret();
export function mcpSessionVersion() { return `${authorizationVersion()}:${sessionRevision}`; }
const equal = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const redirectUri = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && (url.protocol === "https:"
      || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
}, "回调地址必须是 HTTPS 或本机 HTTP 地址");
export const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120), redirect_uris: z.array(redirectUri).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
  response_types: z.array(z.literal("code")).optional(),
});
type Client = z.infer<typeof registrationSchema> & { client_id: string };
type Token = { clientId: string; grant: string; kind: "access" | "refresh" | "usedRefresh"; expires: number };
type Store = { version: string; clients: Client[]; tokens: Record<string, Token> };
let queue: Promise<unknown> = Promise.resolve();
function transaction<T>(operation: (store: Store) => T | Promise<T>, write = true): Promise<T> {
  const job = queue.then(async () => {
    const path = join(dirname(conf.path), "mcpOauth.json");
    const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return; throw error; });
    const version = authorizationVersion();
    const saved = text ? JSON.parse(text) as Store : undefined;
    const store: Store = saved?.version === version ? saved : { version, clients: [], tokens: {} };
    for (const [key, token] of Object.entries(store.tokens)) if (token.expires <= Date.now()) delete store.tokens[key];
    const result = await operation(store);
    if (version !== authorizationVersion()) throw Object.assign(new Error("认证设置已变化，请重新授权"), { status: 409 });
    if (write) {
      await mkdir(dirname(path), { recursive: true });
      await writeAtomic(path, JSON.stringify(store), { mode: 0o600 });
    }
    return result;
  });
  queue = job.catch(() => undefined);
  return job;
}
function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }
const attempts = new Map<string, { count: number; until: number }>();
export function limitOauth(req: Request) {
  const now = Date.now();
  for (const [key, item] of attempts) if (item.until <= now) attempts.delete(key);
  // ACT: 单进程按直连地址限流；代理后的请求共享额度，不信任调用方转发头。
  const key = req.socket.remoteAddress ?? "unknown";
  const item = attempts.get(key) ?? { count: 0, until: now + 60_000 };
  if (++item.count > 60 || attempts.size >= 4096) throw Object.assign(new Error("请求过多，请稍后重试"), { status: 429 });
  attempts.set(key, item);
}
export async function registerClient(input: z.infer<typeof registrationSchema>) {
  oauthOrigin();
  return transaction(store => {
    if (store.clients.length >= 256) invalid("客户端数量已达上限");
    const client = { ...input, client_id: crypto.randomUUID(), token_endpoint_auth_method: "none" as const,
      grant_types: ["authorization_code", "refresh_token"] as ("authorization_code" | "refresh_token")[], response_types: ["code"] as "code"[] };
    store.clients.push(client);
    return client;
  });
}
export const authorizeSchema = z.object({
  client_id: z.string().max(200), redirect_uri: redirectUri, response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal("S256"),
  resource: z.string().max(2048), state: z.string().max(2048).optional(), scope: z.literal("mcp").optional(),
});
type Authorization = z.infer<typeof authorizeSchema> & { version: string; expires: number; clientName: string };
const pending = new Map<string, Authorization>();
const codes = new Map<string, Authorization>();
function prune(items: Map<string, Authorization>) {
  for (const [key, item] of items) if (item.expires <= Date.now() || item.version !== authorizationVersion()) items.delete(key);
  if (items.size >= 256) invalid("授权请求过多，请稍后重试");
}
export async function beginAuthorization(input: z.infer<typeof authorizeSchema>) {
  const origin = oauthOrigin();
  if (input.resource !== `${origin}/mcp`) invalid("resource 与 MCP 地址不一致");
  const client = await transaction(store => store.clients.find(client => client.client_id === input.client_id), false);
  if (!client || !client.redirect_uris.includes(input.redirect_uri)) invalid("客户端或回调地址未注册");
  prune(pending);
  const id = secret();
  pending.set(id, { ...input, version: authorizationVersion(), expires: Date.now() + 300_000, clientName: client.client_name });
  return { id, clientName: client.client_name, redirectUri: input.redirect_uri };
}
export function approveAuthorization(id: string, token: string, approved: boolean) {
  oauthOrigin();
  if (!sameToken(token, oauthOwnerToken())) throw Object.assign(new Error("管理员访问令牌不正确"), { status: 401 });
  prune(pending);
  const authorization = pending.get(id);
  if (!authorization) invalid("授权请求已过期，请重新连接");
  pending.delete(id);
  const target = new URL(authorization.redirect_uri);
  if (authorization.state !== undefined) target.searchParams.set("state", authorization.state);
  if (approved) {
    prune(codes);
    const code = secret();
    codes.set(hash(code), authorization);
    target.searchParams.set("code", code);
  } else target.searchParams.set("error", "access_denied");
  target.searchParams.set("iss", oauthOrigin());
  return target.href;
}
export const tokenSchema = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]), client_id: z.string().max(200),
  code: z.string().max(200).optional(), redirect_uri: redirectUri.optional(),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(),
  refresh_token: z.string().max(200).optional(), resource: z.string().max(2048),
});
export async function exchangeToken(input: z.infer<typeof tokenSchema>) {
  if (input.resource !== `${oauthOrigin()}/mcp`) invalid("resource 与 MCP 地址不一致");
  const result = await transaction(store => {
    let grant: string;
    if (input.grant_type === "authorization_code") {
      prune(codes);
      const key = hash(input.code ?? "");
      const code = codes.get(key);
      if (!code || code.client_id !== input.client_id || code.redirect_uri !== input.redirect_uri
        || !input.code_verifier || !equal(hash(input.code_verifier), code.code_challenge)) invalid("invalid_grant");
      codes.delete(key);
      grant = crypto.randomUUID();
    } else {
      const key = hash(input.refresh_token ?? "");
      const refresh = store.tokens[key];
      if (refresh?.kind === "usedRefresh" && refresh.clientId === input.client_id) {
        // 刷新令牌重放说明授权可能泄露，撤销该授权族，并持久化后再返回错误。
        for (const [key, token] of Object.entries(store.tokens)) if (token.grant === refresh.grant) delete store.tokens[key];
        return null;
      }
      if (!refresh || refresh.kind !== "refresh" || refresh.clientId !== input.client_id) invalid("invalid_grant");
      grant = refresh.grant;
      // 刷新时轮换同一授权的全部令牌，旧访问与刷新令牌立即失效。
      for (const [key, token] of Object.entries(store.tokens)) if (token.grant === grant && token.kind !== "usedRefresh") delete store.tokens[key];
      store.tokens[key] = { ...refresh, kind: "usedRefresh" };
    }
    if (Object.keys(store.tokens).length >= 2048) invalid("授权数量已达上限");
    const access = secret();
    const refresh = secret();
    store.tokens[hash(access)] = { clientId: input.client_id, grant, kind: "access", expires: Date.now() + 3600_000 };
    store.tokens[hash(refresh)] = { clientId: input.client_id, grant, kind: "refresh", expires: Date.now() + 14 * 86400_000 };
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, scope: "mcp" };
  });
  if (!result) invalid("invalid_grant");
  return result;
}
export async function revokeToken(token: string, clientId: string) {
  oauthOrigin();
  await transaction(store => {
    const saved = store.tokens[hash(token)];
    if (!saved || saved.clientId !== clientId) return;
    for (const [key, item] of Object.entries(store.tokens)) if (item.grant === saved.grant) delete store.tokens[key];
  });
}
export async function verifyOauthToken(req: Request) {
  if (invalidationFailed) return false;
  oauthOrigin();
  const header = req.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return false;
  return transaction(store => store.tokens[hash(header.slice(7))]?.kind === "access", false);
}
export function oauthChallenge() {
  const origin = publicMcpSettings().publicUrl;
  return origin ? `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="mcp"` : 'Bearer realm="MangaFlow"';
}

let invalidationFailed = false;
function invalidateAuthorization() {
  sessionRevision = secret();
  pending.clear();
  codes.clear();
  // 即使切回原模式也不能恢复旧授权，重置任务与令牌操作共用串行队列。
  invalidationFailed = true;
  void transaction(store => { store.clients = []; store.tokens = {}; })
    .then(() => { invalidationFailed = false; })
    .catch(error => console.error("清除 MCP OAuth 授权失败", error));
}
conf.onDidChange("settings", (next, previous) => {
  const policy = (settings: Record<string, unknown> | undefined) => {
    const mcp = settings?.mcp as Record<string, unknown> | undefined;
    return JSON.stringify([mcp?.enabled, mcp?.authMode, mcp?.publicUrl, mcp?.token]);
  };
  if (policy(next) !== policy(previous)) invalidateAuthorization();
});
conf.onDidChange("mcpTunnel", (next, previous) => {
  const policy = (value: typeof next) => JSON.stringify([value?.managed, value?.publicUrl, value?.token]);
  if (policy(next) !== policy(previous)) invalidateAuthorization();
});
