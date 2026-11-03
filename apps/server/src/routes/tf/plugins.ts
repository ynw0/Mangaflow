import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { callTf, resolveTfApiKey } from "@/utils/tf/market";

const router = Router();

export default router.post("/", validateFields({
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(50),
  type: z.enum(["all", "node", "skill", "tool", "agent", "ext", "my", "collection"]),
  searchKeyword: z.string().max(200).optional(),
  apiKey: z.string().max(512).optional(),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { page, limit, type, searchKeyword, apiKey } = req.body as {
    page: number; limit: number; type: string; searchKeyword?: string; apiKey?: string;
  };
  const key = resolveTfApiKey(apiKey);
  if (!key) return res.status(400).json(error("请先配置 TF-Router API Key"));
  const data = await callTf("/v1/plugin/getPlugin", { page, limit, type, searchKeyword }, key);
  res.json(success(data));
});
