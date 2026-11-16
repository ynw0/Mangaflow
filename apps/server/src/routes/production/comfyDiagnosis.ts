import { Router } from "express";
import { z } from "zod";
import { analyzeComfyFailure, comfyDiagnosisInput } from "@/agent/tools/comfyDiagnosis";
import { validateFields } from "@/lib/middleware";
import { errorFromCause, success } from "@/lib/responseFormat";
import u from "@/utils";

const schema = comfyDiagnosisInput.extend({
  directory: z.string().min(1).max(4096),
  providerId: z.string().min(1).max(256),
  modelId: z.string().min(1).max(256),
});

export default Router().post("/", validateFields(schema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { directory, providerId, modelId, ...input } = schema.parse(req.body);
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  res.set({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableNeedDrain) res.write("\n"); }, 5000);
  try {
    const result = await analyzeComfyFailure({ ...input, cwd, signal: controller.signal, primaryModel: { providerId, modelId, thinkingLevel: "off" } });
    if (!res.destroyed) res.write(JSON.stringify(success(result)));
  } catch (error) {
    if (!res.destroyed) res.write(JSON.stringify(errorFromCause(error)));
  } finally {
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
    res.end();
  }
});
