// 运行中消息引导：不替换/关闭原 SSE，也不发送任务 abort。
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success, errorFromCause } from "@/lib/responseFormat";
import u from "@/utils";

const fields = {
  directory: z.string().trim().min(1).max(4096),
  sessionFile: z.string().regex(/^[\\w-]+\\.jsonl$/),
  requestId: z.uuid(),
  prompt: z.string().trim().min(1).max(20000),
};

export default Router().post("/", validateFields(fields), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  try {
    const { directory, sessionFile, requestId, prompt } = req.body as {
      directory: string; sessionFile: string; requestId: string; prompt: string;
    };
    const { path } = await u.workspaceFile.resolveWorkspaceFile(req, directory, `.agent/sessions/${sessionFile}`);
    const result = await u.agent.steerActiveAgentSession(path, { requestId, prompt });
    res.set("Cache-Control", "no-store").json(success(result));
  } catch (cause) {
    const response = errorFromCause(cause);
    res.status(response.code >= 400 && response.code < 600 ? response.code : 500).json(response);
  }
});
