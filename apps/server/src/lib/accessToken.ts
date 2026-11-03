import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { error } from "@/lib/responseFormat";

const cookieName = "toonflowAccess";
const tokenPattern = /^[A-Za-z0-9._~-]{32,256}$/;

export function accessToken() {
  const token = process.env.TOONFLOW_TOKEN?.trim() ?? "";
  if (!token) return "";
  if (!tokenPattern.test(token)) throw new Error("TOONFLOW_TOKEN 必须是 32 到 256 位的字母、数字或 ._~-");
  return token;
}

export function assertListenAllowed(host: string) {
  const token = accessToken();
  if (token) return;
  if (process.env.TOONFLOW_AUTH_PROXY === "1") {
    console.warn("TOONFLOW_AUTH_PROXY=1：本进程不校验访问令牌，反向代理必须先完成认证。");
    return;
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("监听非本机地址时必须设置 TOONFLOW_TOKEN，或设置 TOONFLOW_AUTH_PROXY=1 表示前方已有认证代理");
  }
}

function readCookie(req: Request) {
  for (const part of (req.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== cookieName) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return ""; }
  }
  return "";
}

function presentedToken(req: Request) {
  const header = req.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  return bearer || readCookie(req);
}

export function sameToken(value: string) {
  const expected = accessToken();
  if (!expected) return false;
  const actual = Buffer.from(value);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function tokenMatches(req: Request) {
  return sameToken(presentedToken(req));
}

export function accessStatus(req: Request) {
  const required = Boolean(accessToken());
  return { required, authenticated: required && tokenMatches(req) };
}

export function setAccessCookie(res: Response, token: string) {
  res.set("Set-Cookie", `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
}

export function requireAccessToken(req: Request, res: Response, next: NextFunction) {
  if (!accessToken()) return next();
  const path = req.path;
  if ((req.method === "GET" && path === "/api/auth/status") || (req.method === "POST" && path === "/api/auth/login")) return next();
  if (!path.startsWith("/api") && !path.startsWith("/mcp") && !path.startsWith("/a2a")) return next();
  if (tokenMatches(req)) return next();
  res.status(401).set("Cache-Control", "no-store").json(error("需要访问令牌", null, 401));
}
