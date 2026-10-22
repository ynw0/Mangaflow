// 成片视听质检：抽帧 + 抽音轨，按 settings.production 质检模型验收。
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success, errorFromCause } from "@/lib/responseFormat";
import { validationOptions } from "@/lib/i18n";
import u from "@/utils";

const inputSchema = z.object({
  directory: z.string().min(1).max(4096),
  videoPath: z.string().min(1).max(4096),
  checklist: z.string().max(8000).optional(),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  try {
    const input = inputSchema.parse(req.body, validationOptions());
    const directory = await u.workspace.resolveWorkspace(req, input.directory);
    const data = await u.production.runProductionQc({
      directory,
      videoPath: input.videoPath,
      checklist: input.checklist,
      signal: AbortSignal.timeout(180_000),
    });
    res.set("Cache-Control", "no-store").json(success(data));
  } catch (cause) {
    const response = errorFromCause(cause);
    res.status(response.code >= 400 && response.code < 600 ? response.code : 500).json(response);
  }
});