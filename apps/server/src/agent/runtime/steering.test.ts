import { describe, expect, test } from "bun:test";
import { enqueueAgentGuidance, type LiveSteeringSession } from "./steering";

function sessionFixture() {
  const sent: { text: string; options: unknown }[] = [];
  const session: LiveSteeringSession = {
    isStreaming: true,
    pendingMessageCount: 0,
    async sendUserMessage(text, options) { sent.push({ text, options }); },
  };
  return { session, sent, requests: new Map<string, Promise<void>>() };
}

describe("运行中引导不打断生成", () => {
  test("引导复用当前 SDK 会话，只以 steer 排队，不触发 stop 或 restart", async () => {
    const { session, requests, sent } = sessionFixture();
    const input = { prompt: "继续当前 15s 连续镜头，但先保证结构连接正确", requestId: "aa" };
    expect(await enqueueAgentGuidance(session, requests, input)).toEqual({
      status: "queued", requestId: "aa", duplicate: false,
    });
    expect(sent).toEqual([{ text: input.prompt, options: { deliverAs: "steer", expandPromptTemplates: false } }]);
  });

  test("网络重试同一 requestId 必须幂等，不能再插入第二次", async () => {
    const { session, requests, sent } = sessionFixture();
    const input = { prompt: "不要删除镜头", requestId: "bb" };
    await enqueueAgentGuidance(session, requests, input);
    const result = await enqueueAgentGuidance(session, requests, input);
    expect(result.duplicate).toBe(true);
    expect(sent).toHaveLength(1);
  });

  test("运行停止后拒绝引导，旧会话不能被隐式重启", async () => {
    const { requests, sent } = sessionFixture();
    const idle: LiveSteeringSession = {
      isStreaming: false, pendingMessageCount: 0,
      async sendUserMessage() { sent.push({ text: "unexpected", options: {} }); },
    };
    await expect(enqueueAgentGuidance(idle, requests, { prompt: "继续", requestId: "cc" })).rejects.toMatchObject({ status: 409 });
    expect(sent).toHaveLength(0);
  });

  test("排队已满只返回错误，不调用 SDK 或取消当前工具", async () => {
    const { session, requests, sent } = sessionFixture();
    const full: LiveSteeringSession = { ...session, pendingMessageCount: 16 };
    await expect(enqueueAgentGuidance(full, requests, { prompt: "新引导", requestId: "dd" })).rejects.toMatchObject({ status: 429 });
    expect(sent).toHaveLength(0);
  });

  test("SDK 拒绝投递后清除幂等记录，允许保留草稿再次发送", async () => {
    const requests = new Map<string, Promise<void>>();
    let n = 0;
    const session: LiveSteeringSession = { isStreaming: true, pendingMessageCount: 0,
      async sendUserMessage() { if (++n === 1) throw new Error("SDK queue failed"); } };
    const input = { prompt: "继续", requestId: "ee" };
    await expect(enqueueAgentGuidance(session, requests, input)).rejects.toThrow("SDK queue failed");
    expect(requests.has(input.requestId)).toBe(false);
    expect((await enqueueAgentGuidance(session, requests, input)).status).toBe("queued");
  });
});
