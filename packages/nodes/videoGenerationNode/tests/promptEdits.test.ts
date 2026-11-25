import { describe, expect, test } from "bun:test";
import { applyPromptEdits } from "../src/promptEdits";

describe("视频提示词精确局部修改", () => {
  const source = {
    prompt: "subject_definitions:\r\n<Subject 1> is Su Li.\r\n[Shot 1] She asks at 1.0x normal conversational speed <d>[Mandarin Chinese] 你用的还是原来那根销子？</d>.\r\n[Shot 2] At 00:05.000, the camera cuts to the pin.\r\n",
    promptZh: "苏黎以1.0倍正常语速问：你用的还是原来那根销子？",
  };
  test("1.0 与 1.1 对比只替换语速，全部其他字节保留", () => {
    const result = applyPromptEdits(source, [
      { field: "prompt", before: "1.0x", after: "1.1x" },
      { field: "promptZh", before: "1.0倍", after: "1.1倍" },
    ]);
    expect(result.prompt.replace("1.1x", "1.0x")).toBe(source.prompt);
    expect(result.promptZh.replace("1.1倍", "1.0倍")).toBe(source.promptZh);
    expect(source.prompt).toContain("1.0x");
  });
  test("未编辑的中文对照不被清空或重写", () => {
    expect(applyPromptEdits(source, [{ field: "prompt", before: "1.0x", after: "1.1x" }]).promptZh).toBe(source.promptZh);
  });
  test("不存在或不唯一的原文拒绝，不产生部分修改", () => {
    expect(() => applyPromptEdits(source, [
      { field: "prompt", before: "1.0x", after: "1.1x" },
      { field: "promptZh", before: "不存在的文字", after: "其他" },
    ])).toThrow("找不到");
    expect(() => applyPromptEdits(source, [{ field: "prompt", before: "Shot", after: "Scene" }])).toThrow("出现多次");
    expect(source.prompt).toContain("1.0x");
  });
  test("所有位置从原稿定位，拒绝重叠；保留换行和特殊字符", () => {
    expect(() => applyPromptEdits(source, [
      { field: "prompt", before: "1.0x", after: "1.1x" },
      { field: "prompt", before: "1.0x normal", after: "1.2x normal" },
    ])).toThrow("重叠");
    const result = applyPromptEdits({ prompt: "A B C\r\n", promptZh: "" }, [
      { field: "prompt", before: "A", after: "B" },
      { field: "prompt", before: "B", after: "$&" },
    ]);
    expect(result.prompt).toBe("B $& C\r\n");
  });
});
