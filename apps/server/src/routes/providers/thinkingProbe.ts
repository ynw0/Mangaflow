import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { probeConfiguredThinkingLevels } from "@/utils/ai/thinkingProbe";
import u from "@/utils";

// 仅用当前应用已保存的供应商凭证探测；从不接受客户端传来的任意 URL 或密钥。
export default Router().post("/", validateFields({
  providerId: z.string().trim().min(1).max(256),
  modelId: z.string().trim().min(1).max(256),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { providerId, modelId } = req.body as { providerId: string; modelId: string };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.once("close", cancel);
  try {
    const result = await probeConfiguredThinkingLevels(providerId, modelId, controller.signal);
    if (!controller.signal.aborted) res.set("Cache-Control", "no-store").json(success({ providerId, modelId, ...result }));
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    res.off("close", cancel);
  }
});
