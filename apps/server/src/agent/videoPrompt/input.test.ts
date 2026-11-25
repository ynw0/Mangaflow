import { describe, expect, test } from "bun:test";
import { inspectCanvasPromptParameters, inspectCanvasPromptToolSchema } from "./input";

describe("inspectCanvasVideoPrompt 参数", () => {
  const node = { canvasId: "canvas1", nodeId: "video1" };

  test("只需要目标节点，可选合同字段；拒绝未知导演编排字段", () => {
    expect(inspectCanvasPromptParameters.parse({ node })).toEqual({ node });
    expect(inspectCanvasPromptParameters.parse({
      node, story: "主角检查机械接点。", mustHave: ["工具接触车辆"], mustNotHave: ["人物突然消失"],
      lockedDialogue: [],
    })).toMatchObject({ node, lockedDialogue: [] });
    expect(() => inspectCanvasPromptParameters.parse({})).toThrow();
    expect(() => inspectCanvasPromptParameters.parse({ node, shotId: "S01" })).toThrow();
    expect(() => inspectCanvasPromptParameters.parse({ node, regenerate: true })).toThrow();
    expect(inspectCanvasPromptToolSchema.required).toEqual(["node"]);
  });

  test("声音选择按说话人传原生数组，拒绝字符串化参数或无效编号", () => {
    const voiceCast = [{ speakerId: "S1", characterName: "主角" }];
    expect(inspectCanvasPromptParameters.parse({ node, voiceCast }).voiceCast).toHaveLength(1);
    expect(() => inspectCanvasPromptParameters.parse({ node, voiceCast: JSON.stringify(voiceCast) })).toThrow();
    expect(() => inspectCanvasPromptParameters.parse({ node, voiceCast: [{ speakerId: "S0", characterName: "主角" }] })).toThrow();
  });
});

describe("每段独立视频的说话人编号", () => {
  const node = { canvasId: "c", nodeId: "n" };
  const voiceCast = [
    { speakerId: "S2", characterName: "谭小满" },
    { speakerId: "S3", characterName: "郑楷" },
    { speakerId: "S1", characterName: "播报员" },
  ];
  test("允许按任意数组顺序传入连续编号", () => {
    expect(inspectCanvasPromptParameters.parse({ node, voiceCast }).voiceCast).toEqual(voiceCast);
  });
  test("拒绝整部剧的 S7/S4/S3 编号及重复编号，并提示重新分配", () => {
    for (const ids of [["S4", "S3", "S7"], ["S1", "S1", "S3"], ["S1", "S3", "S4"]]) {
      const result = inspectCanvasPromptParameters.safeParse({
        node, voiceCast: voiceCast.map((role, index) => ({ ...role, speakerId: ids[index] })),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(item => item.path.join(".") === "voiceCast" && item.message.includes("S1、S2、S3"))).toBe(true);
      }
    }
  });
  test("没有指定声音模板时仍允许省略 voiceCast", () => {
    expect(inspectCanvasPromptParameters.safeParse({ node }).success).toBe(true);
  });
});
