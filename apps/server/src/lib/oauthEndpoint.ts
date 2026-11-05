import type { Request, Response } from "express";
import { validateFields } from "@/lib/middleware";
import { limitOauth } from "@/utils/mcp/oauth";
import type { z } from "zod";

export function validateOauth(shape: Record<string, z.ZodType>, source: "body" | "query" = "body") {
  const validate = validateFields(shape, source, (res, errors) => { res.status(400).json({ error: "invalid_request", error_description: errors.join("；") }); });
  return (req: Request, res: Response, next: import("express").NextFunction) => {
    res.set("Cache-Control", "no-store");
    validate(req, res, next);
  };
}
export function oauthEndpoint(action: (req: Request, res: Response) => unknown | Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.set({ "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    try { limitOauth(req); await action(req, res); }
    catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : "OAuth 请求失败";
      res.status(status).json({ error: message === "invalid_grant" ? message : status >= 500 ? "server_error" : "invalid_request", error_description: status === 500 ? "OAuth 存储操作失败" : message });
    }
  };
}
