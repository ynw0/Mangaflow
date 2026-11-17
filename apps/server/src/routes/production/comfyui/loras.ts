// 从当前 ComfyUI 主机合并读取视频权重与 LoRA，保持主机的电源状态。
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
  const signal = AbortSignal.timeout(10000);
  const baseUrl = await u.production.resolveComfyBaseUrl(signal, undefined, false);
  const [names, checkpoints] = await Promise.all([
    u.production.readNodeChoices(baseUrl, "LoraLoaderModelOnly", "lora_name", signal),
    entry.checkpoint ? u.production.readNodeChoices(baseUrl, "UNETLoader", "unet_name", signal) : [],
  ]);
  const advanced = entry.h3Advanced ? await Promise.allSettled([
    u.production.readNodeChoices(baseUrl, "KSamplerSelect", "sampler_name", signal),
    u.production.readNodeChoices(baseUrl, "BasicScheduler", "scheduler", signal),
  ]) : undefined;
  res.set("Cache-Control", "no-store").json(success({
    modelId: entry.id,
    defaultName: entry.loraDefaultName,
    names,
    checkpoints: checkpoints.filter(u.production.isH3CheckpointName),
    ...(advanced ? { samplers: advanced[0]?.status === "fulfilled" ? advanced[0].value : [], schedulers: advanced[1]?.status === "fulfilled" ? advanced[1].value : [], advancedError: advanced.some(item => item.status === "rejected") ? "部分高级选项读取失败，请刷新重试" : undefined } : {}),
  }));
});
