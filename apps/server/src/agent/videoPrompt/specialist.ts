import { dirname } from "node:path";
import { SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { runSubAgent, type SubAgentModel } from "@/agent/runtime/subAgent";
import { createAgentConversation, getAgentStats, registerAgentSession, updateSubAgent } from "@/agent/runtime/sessions";
import type { AgentModelSelection } from "@/agent/runtime/profiles";
import type { AgentEvent, AgentSubAgent } from "@/agent/runtime/types";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";

export async function runVideoPromptSpecialist<T>(options: SubAgentModel & {
  cwd: string; parentFile: string; name: string; shotId: string; task: string; instructions: string;
  selection: AgentModelSelection; schema: z.ZodType<T>; parameters: ToolDefinition["parameters"];
  signal?: AbortSignal; send(event: AgentEvent): void; onProgress(text: string): void;
}) {
  const { cwd, parentFile, name, shotId, task, instructions, selection, schema, parameters, signal, send, onProgress, ...model } = options;
  const controller = new AbortController();
  const childSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  childSignal.throwIfAborted();
  const info = { ...selection, parentFile, name, task: `镜头 ${shotId}`, specialist: true };
  const child = await createAgentConversation(cwd, info);
  const agent: AgentSubAgent = { ...info, file: child.file, status: "running" };
  const { path } = await resolveWorkspacePath(cwd, `.agent/sessions/${child.file}`);
  const history = SessionManager.open(path, dirname(path), cwd);
  const finished = Promise.withResolvers<void>();
  const sendChild = (event: AgentEvent) => send({ type: "subAgentEvent", file: child.file, event });
  const release = lockWorkspaceFiles([path]);
  const unregister = registerAgentSession(path, {
    history, entryOffset: history.getEntries().length, send: sendChild,
    tools: new Map(), steeringRequests: new Map(),
    abort: () => { controller.abort(); return finished.promise; },
  });

  let submitted: T | undefined;
  const resultTool: ToolDefinition = {
    name: "submitResult",
    label: "提交结构化结果",
    description: "按任务给出的字段定义提交当前阶段的完整结果。",
    parameters,
    executionMode: "sequential",
    async execute(_id, args, toolSignal) {
      toolSignal?.throwIfAborted();
      if (submitted !== undefined) throw new Error("本轮已经提交结果");
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error.issues.flatMap(issue => {
          if (issue.code === "invalid_union" && issue.errors.length) return issue.errors.flat();
          return [issue];
        });
        throw new Error(issues.slice(0, 8).map(issue => `${issue.path.join(".") || "结果"}：${issue.message}`).join("\n"));
      }
      submitted = parsed.data;
      return { content: [{ type: "text", text: "结构化结果校验通过" }], details: {} };
    },
  };

  const startedAt = performance.now();
  let phase = "准备模型请求";
  let timer: ReturnType<typeof setInterval> | undefined;
  const progress = () => {
    if (childSignal.aborted) return;
    const text = `${phase} · 已用 ${Math.floor((performance.now() - startedAt) / 1000)} 秒`;
    onProgress(text);
    send({ type: "subAgent", agent: { ...agent, result: text } });
    sendChild({ type: "text", blockId: "specialistProgress", content: text });
  };
  try {
    await updateSubAgent(cwd, parentFile, agent);
    progress();
    timer = setInterval(progress, 2000);
    const output = await runSubAgent({
      ...model, cwd, name, task, instructions, tools: [], resultTool, history, signal: childSignal,
      onProgress: message => { phase = message; },
    });
    clearInterval(timer);
    if (output.result.status === "completed" && submitted === undefined) {
      output.result.status = "error";
      output.result.result = "服务端未收到已校验的提交结果";
    }
    const summary = `${output.result.result} · ${output.usage.totalTokens.toLocaleString("zh-CN")} Token`;
    await updateSubAgent(cwd, parentFile, { ...agent, status: output.result.status, result: summary });
    sendChild({ type: "stats", stats: getAgentStats(history) });
    sendChild({ type: "text", blockId: "specialistProgress", content: summary, done: true });
    if (output.result.status !== "completed") sendChild({ type: "error", message: summary });
    return { ...output, submitted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateSubAgent(cwd, parentFile, { ...agent, status: childSignal.aborted ? "cancelled" : "error", result: message });
    sendChild({ type: "error", message });
    throw error;
  } finally {
    clearInterval(timer);
    sendChild({ type: "done" });
    unregister();
    release();
    finished.resolve();
  }
}
