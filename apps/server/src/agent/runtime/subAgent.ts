import type { Usage } from "@earendil-works/pi-ai";
import { createAgentSession, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, CreateAgentSessionOptions, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ToolCall } from "@toonflow/tools-scaffold/runtime";
import { createAgentResources } from "@/agent/runtime/resources";
import { configureAgentRequests } from "@/agent/runtime/requests";
import { getToolResultText } from "@/agent/runtime/sessions";

export type SubAgentModel = Pick<CreateAgentSessionOptions, "modelRuntime" | "model" | "thinkingLevel">;
export type SubAgentResult = {
  name: string;
  status: "running" | "completed" | "error" | "limited" | "cancelled" | "inputRequired";
  result: string;
  taskId?: string;
  contextId?: string;
};

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

export function addUsage(total: Usage, value: Usage) {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) total[key] += value[key];
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) total.cost[key] += value.cost[key];
}

export async function runSubAgent(options: SubAgentModel & {
  cwd: string;
  name: string;
  task: string;
  tools: ToolDefinition[];
  instructions?: string;
  signal?: AbortSignal;
  history?: SessionManager;
  inputRequired?: () => string | undefined;
  onTool?: (tool: ToolCall) => void;
  onProgress?: (message: string) => void;
  resultTool?: ToolDefinition;
}) {
  const { cwd, name, task, tools, instructions, signal = new AbortController().signal, history, inputRequired, onTool, onProgress, resultTool, ...modelOptions } = options;
  const result: SubAgentResult = { name, status: "running", result: "准备执行" };
  const usage = emptyUsage();
  let session: AgentSession | undefined;
  const abort = () => { void session?.abort(); };
  signal.addEventListener("abort", abort, { once: true });
  // A2A 继续任务复用内存历史；只汇总本次新增记录，避免重复计费。
  const previousEntries = history?.getEntries().length ?? 0;
  try {
    signal.throwIfAborted();
    const activeTools = (resultTool ? [resultTool] : tools).map(tool => ({
      ...tool,
      async execute(...args: Parameters<ToolDefinition["execute"]>) {
        signal.throwIfAborted();
        // ACT: SDK 在整批工具结束后才停轮；提出问题后不再执行本批后续操作。
        if (inputRequired?.()) throw new Error("任务正在等待调用方补充输入，不能继续执行工具");
        if (tool.name !== "askUser" || !onTool) return tool.execute(...args);
        // 子会话的模型调用 ID 可能重复，提问卡片与回答通道使用独立 ID。
        const id = crypto.randomUUID();
        onTool({ id, name: tool.name, args: args[1] as Record<string, unknown>, status: "running" });
        try {
          const output = await tool.execute(id, args[1], args[2], args[3], args[4]);
          onTool({ id, name: tool.name, status: "success", result: output.content.filter(part => part.type === "text").map(part => part.text).join("\n") });
          return output;
        } catch (error) {
          onTool({ id, name: tool.name, status: signal.aborted ? "interrupted" : "error", result: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      },
    }));
    const resources = await createAgentResources(cwd, activeTools, SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, provider: { maxRetries: 0 } },
    }), instructions, false, Boolean(resultTool));
    signal.throwIfAborted();
    ({ session } = await createAgentSession({
      ...modelOptions, ...resources, cwd,
      sessionManager: history ?? SessionManager.inMemory(cwd),
      customTools: activeTools,
      tools: activeTools.map(tool => tool.name),
    }));
    configureAgentRequests(session, undefined, modelOptions.thinkingLevel);
    signal.throwIfAborted();
    // 专家只提交一次结果，完成校验后结束本轮，避免模型再生成一段自由文本。
    session.agent.shouldStopAfterTurn = () => Boolean(resultTool || inputRequired?.());
    let received = 0;
    let reportedAt = 0;
    session.subscribe(event => {
      if (signal.aborted) return;
      if (event.type === "message_start" && event.message.role === "assistant") onProgress?.(resultTool ? "等待模型输出" : "正在处理");
      if (resultTool && event.type === "message_update") {
        const update = event.assistantMessageEvent;
        if (update.type === "thinking_delta" || update.type === "text_delta" || update.type === "toolcall_delta") {
          received += update.delta.length;
          const now = performance.now();
          if (now - reportedAt >= 500) {
            const stage = update.type === "thinking_delta" ? "模型正在推理" : update.type === "toolcall_delta" ? "模型正在提交结果" : "模型正在回复";
            onProgress?.(`${stage}，已接收 ${received.toLocaleString("zh-CN")} 字符`);
            reportedAt = now;
          }
        }
      }
      if (event.type === "tool_execution_start") onProgress?.(resultTool ? "正在校验提交结果" : `正在调用 ${event.toolName}`);
    });
    const request = resultTool
      ? `任务：${name}。完成内部推理后，直接调用 ${resultTool.name} 一次提交符合字段定义的完整结果。正文、结论和证据全部写在工具参数中。\n\n${task}`
      : `你正在执行委派的独立子任务。仅处理下述任务，遵守系统中的授权与工作区规则。缺少信息或授权时，说明阻碍并交回调用方；若提供 requestInput 则使用它等待补充。最终返回简明结论、实际修改的文件相对路径、验证情况与未完成项；长篇产物写入已授权的工作区文件。\n\n${JSON.stringify({ name, task })}`;
    await session.prompt(request, { expandPromptTemplates: false });
    signal.throwIfAborted();
    const question = inputRequired?.();
    const reply = session.messages.findLast(message => message.role === "assistant");
    if (!reply || reply.role !== "assistant") throw new Error("子任务没有返回回复");
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      const message = reply.errorMessage || "子任务执行失败";
      throw new Error(resultTool ? `模型响应${reply.stopReason === "aborted" ? "已中断" : "失败"}：${message}` : message);
    }
    if (resultTool) {
      if (reply.stopReason === "length") {
        result.status = "limited";
        result.result = "模型达到输出长度限制，未完整提交结果";
        return { result, usage };
      }
      const calls = reply.content.filter(part => part.type === "toolCall" && part.name === resultTool.name);
      const [call] = calls;
      if (calls.length !== 1 || call?.type !== "toolCall") {
        throw new Error(calls.length ? `模型重复调用 ${resultTool.name}` : `模型已结束回复，未调用 ${resultTool.name}`);
      }
      const submitted = session.messages.findLast(message => message.role === "toolResult" && message.toolCallId === call.id);
      if (!submitted || submitted.role !== "toolResult") throw new Error("结果提交未完成");
      if (submitted.isError) {
        const message = getToolResultText(submitted.content).split("\n\nReceived arguments:")[0]!;
        throw new Error(`${resultTool.name} 字段校验失败：${message.slice(0, 900)}`);
      }
      result.status = "completed";
      result.result = "结构化结果校验通过";
      return { result, usage };
    }
    const text = question ?? reply.content.filter(part => part.type === "text").map(part => part.text).join("\n").trim();
    if (!text) throw new Error("子任务没有返回文本结果");
    const truncated = text.length > 16000;
    result.status = question ? "inputRequired" : reply.stopReason === "length" || truncated ? "limited" : "completed";
    const summary = truncated ? `${text.slice(0, 16000)}\n[结果过长，已截断；请读取工作区产物]` : text;
    result.result = reply.stopReason === "length" ? `${summary}\n[模型输出达到长度限制，任务可能未完成]` : summary;
  } catch (error) {
    result.status = signal.aborted ? "cancelled" : "error";
    const reason = signal.aborted ? signal.reason : error;
    result.result = reason instanceof Error ? reason.message : "子任务执行失败";
  } finally {
    signal.removeEventListener("abort", abort);
    if (session) {
      try {
        await session.abort();
        for (const entry of session.sessionManager.getEntries().slice(previousEntries)) {
          if (entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "toolResult") && entry.message.usage) addUsage(usage, entry.message.usage);
        }
      } finally { session.dispose(); }
    }
  }
  return { result, usage };
}
