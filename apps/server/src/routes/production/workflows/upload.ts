// 上传 Comfy API 视频工作流：LLM 生成 bindings，校验失败不写盘。
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

const inputSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().max(80).optional(),
  apiJson: z.unknown(),
  providerId: z.string().min(1).max(200).optional(),
  modelId: z.string().min(1).max(500).optional(),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body);
  const result = await u.production.uploadVideoWorkflow(input);
  res.set("Cache-Control", "no-store").json(success(result, "工作流已上传"));
});