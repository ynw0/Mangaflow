import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

const inputSchema = z.object({
  directory: z.string().min(1),
  callId: z.uuid(),
  action: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("start") }),
    z.strictObject({ type: z.literal("success"), result: z.json() }),
    z.strictObject({ type: z.literal("error"), error: z.string().min(1).max(8000) }),
    z.strictObject({ type: z.literal("interrupt"), error: z.string().min(1).max(8000) }),
  ]),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  const { directory, callId, action } = req.body as z.infer<typeof inputSchema>;
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  if (action.type === "start") u.canvas.startCanvasCall(cwd, callId);
  else if (action.type === "interrupt") u.canvas.interruptCanvasCall(cwd, callId, action.error);
  else u.canvas.finishCanvasCall(cwd, callId, action.type === "success" ? { result: action.result } : { error: action.error });
  res.json(success());
});
