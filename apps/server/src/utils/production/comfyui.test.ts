import { describe, expect, test } from "bun:test";
import { cancelPrompt } from "./comfyui";

describe("ComfyUI 定向取消", () => {
  test("远端拒绝删除队列任务时，不会声称取消成功", async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response("unavailable", { status: 503 });
    }) as typeof fetch;
    try {
      await expect(cancelPrompt("http://127.0.0.1:8188", "prompt-test")).rejects.toThrow("删除队列任务失败");
      expect(urls).toEqual(["http://127.0.0.1:8188/queue"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("只向指定的 promptId 发出排队删除和运行中断", async () => {
    const original = globalThis.fetch;
    const calls: { url: string; body: string }[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response("", { status: 200 });
    }) as typeof fetch;
    try {
      await cancelPrompt("http://127.0.0.1:8188", "prompt-test");
      expect(calls.map(call => call.url)).toEqual([
        "http://127.0.0.1:8188/queue",
        "http://127.0.0.1:8188/interrupt",
      ]);
      expect(JSON.parse(calls[0]!.body)).toEqual({ delete: ["prompt-test"] });
      expect(JSON.parse(calls[1]!.body)).toEqual({ prompt_id: "prompt-test" });
    } finally {
      globalThis.fetch = original;
    }
  });
});
