import { describe, expect, test } from "bun:test";
import { videoPromptParameters, videoPromptToolSchema } from "./input";

const base = {
  shotId: "S01",
  story: "主角在车间用仪器检查旧车的机械接点。",
  purpose: "确认机械零件的启动状态",
  style: "电影级写实，车间维修顶灯",
  continuityIn: "人物站在旧车左前侧",
  continuityOut: "人物继续停留在车侧",
  mustHave: ["主角使用工具接触车辆", "机械零件在画面内保持可追踪"],
  mustNotHave: ["人物突然消失"],
  intent: "mechanical",
  references: [],
} as const;

const validBase = () => ({ ...base, mustHave: [...base.mustHave], mustNotHave: [...base.mustNotHave], references: [] });

describe("draftVideoPrompt：根 JSON Schema 类型化兼容", () => {
  test("暴露单根 object，不包含任何顶层 anyOf/oneOf，数组和数字有稳定类型", () => {
    const schema = videoPromptToolSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.anyOf).toBeUndefined();
    expect(schema.oneOf).toBeUndefined();
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.mustHave.type).toBe("array");
    expect(properties.mustNotHave.type).toBe("array");
    expect(properties.references.type).toBe("array");
    expect(properties.templateTags.type).toBe("object");
    expect(properties.node.type).toBe("object");
    expect(properties.duration.type).toBe("integer");
    expect(properties.sampling.type).toBe("object");
    expect(properties.creativeSelection.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["shotId", "mustHave", "mustNotHave", "references", "intent"]));
  });

  test("新镜头使用真实类型的数组、数字和可选检索模板 ID 能通过", () => {
    const input = {
      ...validBase(), duration: 10, ratio: "9:16", seedMode: "random",
      creativeSelection: { narrativeId: "n01", expressionId: "e02", styleId: "s01" },
    };
    expect(videoPromptParameters.parse(input)).toMatchObject(input);
  });

  test("已有节点只传 node/合同，禁止重复发送模型、时长、采样、种子", () => {
    const input = { ...validBase(), node: { canvasId: "canvas1", nodeId: "video1", write: true } };
    expect(videoPromptParameters.parse(input)).toMatchObject(input);
    for (const additional of [
      { modelId: "workflow" }, { duration: 10 }, { ratio: "9:16" },
      { sampling: { firstPassSteps: 8 } }, { seed: 123 }, { seedMode: "fixed" },
    ]) {
      expect(() => videoPromptParameters.parse({ ...input, ...additional })).toThrow();
    }
  });

  test("新镜头 duration/ratio 必填，固定种子和 last 种子校验完整", () => {
    expect(() => videoPromptParameters.parse({ ...validBase(), ratio: "9:16" })).toThrow();
    expect(() => videoPromptParameters.parse({ ...validBase(), duration: 10 })).toThrow();
    expect(() => videoPromptParameters.parse({ ...validBase(), duration: 10, ratio: "9:16", seedMode: "fixed" })).toThrow();
    expect(() => videoPromptParameters.parse({ ...validBase(), duration: 10, ratio: "9:16", seed: 123 })).toThrow();
    expect(videoPromptParameters.parse({ ...validBase(), duration: 10, ratio: "9:16", seedMode: "fixed", seed: 123 }).seed).toBe(123);
    expect(videoPromptParameters.parse({ ...validBase(), duration: 10, ratio: "9:16", seedMode: "last", seed: 123 }).seed).toBe(123);
  });

  test("日志里被字符串化的数组、对象和 duration 明确拒绝，防止误提交", () => {
    const input = { ...validBase(), duration: 10, ratio: "9:16" };
    expect(() => videoPromptParameters.parse({ ...input, mustHave: JSON.stringify(input.mustHave) })).toThrow();
    expect(() => videoPromptParameters.parse({ ...input, mustNotHave: "[]" })).toThrow();
    expect(() => videoPromptParameters.parse({ ...input, references: "[]" })).toThrow();
    expect(() => videoPromptParameters.parse({ ...input, duration: "10" })).toThrow();
    expect(() => videoPromptParameters.parse({ ...input, sampling: "{}" })).toThrow();
    expect(() => videoPromptParameters.parse({ ...input, templateTags: "{}" })).toThrow();
    expect(() => videoPromptParameters.parse({ ...input, creativeSelection: "{\"styleId\":\"s01\"}" })).toThrow();
  });
});
