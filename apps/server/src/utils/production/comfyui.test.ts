import { describe, expect, test } from "bun:test";
import { cancelPrompt, submitWorkflow } from "./comfyui";

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


describe("ComfyUI 用户指定 LoRA 的精确文件标识",()=>{
  test("不允许路径对齐替换已锁定 LoRA；旧默认仍可按唯一文件名迁移",async()=>{
    const original=globalThis.fetch;
    const sent: unknown[]=[];
    globalThis.fetch=(async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
      if(String(input).endsWith("/object_info/LoraLoaderModelOnly")) return Response.json({LoraLoaderModelOnly:{input:{required:{lora_name:[["new/combat.safetensors","new/default.safetensors"]]}}}});
      if(String(input).endsWith("/prompt")){sent.push(JSON.parse(String(init?.body)));return Response.json({prompt_id:"test-id"});}
      throw new Error("unexpected "+String(input));
    }) as typeof fetch;
    try {
      const graph={"21":{class_type:"LoraLoaderModelOnly",inputs:{lora_name:"old/default.safetensors"}},"10000":{class_type:"LoraLoaderModelOnly",inputs:{lora_name:"old/combat.safetensors"}}};
      await submitWorkflow("http://127.0.0.1:8188",graph,undefined,{lockedLoraNodes:["10000"]});
      expect(graph["21"].inputs.lora_name).toBe("new/default.safetensors");
      expect(graph["10000"].inputs.lora_name).toBe("old/combat.safetensors");
      expect(sent).toHaveLength(1);
    }finally{globalThis.fetch=original;}
  });
});
