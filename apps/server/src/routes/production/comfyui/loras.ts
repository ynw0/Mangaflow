// 按当前 ComfyUI 主机的实际节点选项列出已安装的 LoRA；只读取，不自动生成。
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", validateFields({ modelId: z.string().trim().min(1).max(256) }, "query"), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const entry = await u.production.findWorkflow(String(req.query.modelId));
  if (entry.kind !== "video" || !entry.bindings.optionalLoraNode) {
    throw Object.assign(new Error("当前视频工作流没有可选 LoRA 加载器"), { status: 400 });
  }
  const baseUrl = await u.production.resolveComfyBaseUrl();
  const signal = AbortSignal.timeout(10000);
  await u.production.probeComfy(baseUrl, signal);
  const names = await u.production.readNodeChoices(baseUrl, "LoraLoaderModelOnly", "lora_name", signal);
  res.set("Cache-Control", "no-store").json(success({
    modelId: entry.id,
    defaultName: entry.loraDefaultName,
    names,
  }));
});
