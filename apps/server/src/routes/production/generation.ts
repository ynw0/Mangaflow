// 持久化视频任务：查询、列出、显式取消。重连沿用 /api/ai/media/generate 原请求。
import { Router } from "express";
import { z } from "zod";
import { success, errorFromCause } from "@/lib/responseFormat";
import { validationOptions } from "@/lib/i18n";
import { generationJobStatus, listGenerationJobs, cancelGenerationJob } from "@/utils/production/generationJobs";
import u from "@/utils";

const readInput = z.object({ directory: z.string().min(1).max(4096), generationId: z.uuid() });
const listInput = readInput.pick({ directory: true });

export default Router()
  .get("/status", async (req, res) => {
    u.mcpControl.assertAppRequest(req);
    try {
      const input = readInput.parse(req.query, validationOptions());
      const cwd = await u.workspace.resolveWorkspace(req, input.directory);
      res.set("Cache-Control", "no-store").json(success(await generationJobStatus(cwd, input.generationId)));
    } catch (cause) {
      const response = errorFromCause(cause);
      res.status(response.code >= 400 && response.code < 600 ? response.code : 500).json(response);
    }
  })
  .get("/list", async (req, res) => {
    u.mcpControl.assertAppRequest(req);
    try {
      const input = listInput.parse(req.query, validationOptions());
      const cwd = await u.workspace.resolveWorkspace(req, input.directory);
      res.set("Cache-Control", "no-store").json(success(await listGenerationJobs(cwd)));
    } catch (cause) {
      const response = errorFromCause(cause);
      res.status(response.code >= 400 && response.code < 600 ? response.code : 500).json(response);
    }
  })
  .post("/cancel", async (req, res) => {
    u.mcpControl.assertAppRequest(req);
    try {
      const input = readInput.parse(req.body, validationOptions());
      const cwd = await u.workspace.resolveWorkspace(req, input.directory);
      res.set("Cache-Control", "no-store").json(success(await cancelGenerationJob(cwd, input.generationId)));
    } catch (cause) {
      const response = errorFromCause(cause);
      res.status(response.code >= 400 && response.code < 600 ? response.code : 500).json(response);
    }
  });
