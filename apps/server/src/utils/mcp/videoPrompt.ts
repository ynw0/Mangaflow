import { z } from "zod";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { inspectCanvasPromptParameters, readCanvasPromptForInspection } from "@/agent/videoPrompt/input";
import { inspectCurrentVideoPrompt } from "@/agent/videoPrompt/format";

const videoPromptSchema = z.strictObject({
  action: z.literal("inspectNode"),
  input: inspectCanvasPromptParameters,
});
export const videoPromptToolSchema = z.toJSONSchema(videoPromptSchema, { io: "input" });

/** 外部 Agent 与内置工具同一条检查路径：只读画布现稿，不签发审核编号。 */
export async function externalVideoPrompt(directory: string, args: unknown, canvas?: CanvasContext, signal?: AbortSignal) {
  void directory;
  const input = videoPromptSchema.parse(args);
  const prepared = await readCanvasPromptForInspection(input.input, canvas, signal);
  return inspectCurrentVideoPrompt(prepared);
}
