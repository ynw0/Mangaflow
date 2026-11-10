import { describe, expect, test } from "bun:test";
import { advertisedLevels } from "./thinkingProbe";
import { applySelectedReasoningEffort } from "@/agent/runtime/requests";

describe("思考档位自动探测与请求映射", () => {
  test("识别供应商明确列出的 xhigh/medium/low，排除无效 high", () => {
    const message = "Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.";
    expect(advertisedLevels(message)).toEqual(["xhigh", "medium", "low"]);
  });

  test("不把普通错误猜测为已支持的档位", () => {
    expect(advertisedLevels("HTTP 401 invalid API key")).toEqual([]);
  });

  test("OpenAI Completions: 以界面选择的 xhigh 覆盖 SDK 的 high", () => {
    const body: Record<string, unknown> = { model: "qwen3.8-27b", reasoning_effort: "high" };
    applySelectedReasoningEffort(body, "openai-completions", "xhigh");
    expect(body.reasoning_effort).toBe("xhigh");
  });

  test("关闭时删掉 SDK 自动发送的 reasoning_effort", () => {
    const body: Record<string, unknown> = { reasoning_effort: "high" };
    applySelectedReasoningEffort(body, "openai-completions", "off");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  test("OpenAI Responses: 精确映射到 reasoning.effort", () => {
    const body: Record<string, unknown> = { reasoning: { effort: "high", summary: "auto" } };
    applySelectedReasoningEffort(body, "openai-responses", "medium");
    expect(body.reasoning).toEqual({ effort: "medium", summary: "auto" });
    applySelectedReasoningEffort(body, "openai-responses", "off");
    expect(body).not.toHaveProperty("reasoning");
  });
});
