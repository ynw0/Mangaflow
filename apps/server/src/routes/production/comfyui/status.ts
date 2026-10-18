// 探测当前配置的 ComfyUI 是否能连上。
import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const override = typeof req.query.baseUrl === "string" ? req.query.baseUrl.trim() : "";
  const baseUrl = override || await u.production.resolveComfyBaseUrl();
  res.set("Cache-Control", "no-store").json(success(await u.production.probeComfy(baseUrl)));
});
