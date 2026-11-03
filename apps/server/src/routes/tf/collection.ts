import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { callTf, resolveTfApiKey } from "@/utils/tf/market";

const router = Router();

export default router.post("/", validateFields({
  pluginId: z.number().int().min(1),
  apiKey: z.string().max(512).optional(),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { pluginId, apiKey } = req.body as { pluginId: number; apiKey?: string };
  const key = resolveTfApiKey(apiKey);
  if (!key) return res.status(400).json(error("请先配置 TF-Router API Key"));
  const data = await callTf("/v1/plugin/toggleCollection", { pluginId }, key);
  res.json(success(data));
});
