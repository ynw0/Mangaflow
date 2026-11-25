import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { inspectCanvasPromptParameters, inspectCanvasPromptToolSchema, readCanvasPromptForInspection } from "@/agent/videoPrompt/input";
import { inspectCurrentVideoPrompt } from "@/agent/videoPrompt/format";

/** 只读检查画布现稿。主 Agent 自己写提示词，不经导演或独立审核模型。 */
export function createVideoPromptTools(options: { canvas?: CanvasContext }): ToolDefinition[] {
  const { canvas } = options;
  return [{
    name: "inspectCanvasVideoPrompt",
    label: "检查画布视频提示词",
    description: "只读检查画布当前 H3 提示词与实际配置、参考编号及已保存的确认合同。只需 node（canvasId、nodeId）；节点未保存合同时可另传原合同字段。不调用模型、不修改节点、不签发审核编号。",
    promptSnippet: "H3 提示词由主 Agent 按导演及 H3 Skill 直接写到视频节点。第一稿一次写全格式字段。保存后用 inspectCanvasVideoPrompt 检查现稿；发现问题用 node:setPrompt 的 edits 原位修改，expectedRevision 用 getPromptContext 返回的 64 位哈希原样传入。不要委派独立导演或审核模型。",
    parameters: { type: "object", ...inspectCanvasPromptToolSchema },
    executionMode: "sequential",
    async execute(_id, params, signal) {
      const input = inspectCanvasPromptParameters.parse(params);
      const prepared = await readCanvasPromptForInspection(input, canvas, signal);
      const result = inspectCurrentVideoPrompt(prepared);
      return { details: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  }];
}
