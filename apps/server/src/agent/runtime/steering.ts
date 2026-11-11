/** 运行中引导的唯一排队入口。与普通 prompt / abort 独立，可用假的 SDK session 单元测试。 */
export type LiveSteeringSession = {
  readonly isStreaming: boolean;
  readonly pendingMessageCount: number;
  sendUserMessage(text: string, options: { deliverAs: "steer"; expandPromptTemplates: false }): Promise<void>;
};

export async function enqueueAgentGuidance(
  session: LiveSteeringSession | undefined,
  requests: Map<string, Promise<void>>,
  input: { requestId: string; prompt: string },
) {
  if (!session?.isStreaming) {
    throw Object.assign(new Error("当前对话已停止或尚未启动，请作为普通消息发送"), { status: 409 });
  }
  const previous = requests.get(input.requestId);
  if (previous) {
    await previous;
    return { status: "queued" as const, requestId: input.requestId, duplicate: true };
  }
  if (requests.size >= 128) {
    throw Object.assign(new Error("当前会话已接收过多条引导，请在新一轮对话中继续"), { status: 429 });
  }
  if (session.pendingMessageCount >= 16) {
    throw Object.assign(new Error("待处理引导已达上限，请让 Agent 先处理已有消息"), { status: 429 });
  }
  // 保持同一 SDK 会话、同一 SSE 和同一组工具；Pi 会在当前轮次结束后送入下一轮。
  const submitted = session.sendUserMessage(input.prompt, { deliverAs: "steer", expandPromptTemplates: false });
  requests.set(input.requestId, submitted);
  try {
    await submitted;
    return { status: "queued" as const, requestId: input.requestId, duplicate: false };
  } catch (error) {
    requests.delete(input.requestId);
    throw error;
  }
}
