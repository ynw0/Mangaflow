// 探测当前配置的 ComfyUI 是否能连上。
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", validateFields({ host: z.enum(["local", "autodl"]).optional() }, "query"), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const override = typeof req.query.baseUrl === "string" ? req.query.baseUrl.trim() : "";
  const host = req.query.host === "local" || req.query.host === "autodl" ? req.query.host : undefined;
  const baseUrl = override || await u.production.resolveComfyBaseUrl(undefined, host);
  res.set("Cache-Control", "no-store").json(success(await u.production.probeComfy(baseUrl)));
});
