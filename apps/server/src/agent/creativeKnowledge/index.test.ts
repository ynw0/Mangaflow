import { describe, expect, test } from "bun:test";
import { createCreativeKnowledgeSearchTool, searchCreativeKnowledge } from "./index";
import { memesCN } from "./memesCN";
import { absurdPrompts } from "./absurdPrompts";

describe("中国网络热梗与抽象搞怪提示词知识库", () => {
  test("两类知识均有稳定 ID、时间/来源或原创场景与连续性", () => {
    expect(memesCN.length).toBeGreaterThanOrEqual(20);
    expect(absurdPrompts.length).toBeGreaterThanOrEqual(20);
    expect(new Set([...memesCN.map(x => x.id), ...absurdPrompts.map(x => x.id)]).size).toBe(memesCN.length + absurdPrompts.length);
    for (const entry of memesCN) {
      expect(entry.sourceUrl.startsWith("https://")).toBe(true);
      expect(entry.observedAt).toMatch(/^202[56]-\d\d-\d\d$/);
      expect(entry.meaning.length).toBeGreaterThan(10);
      expect(entry.usage.length).toBeGreaterThan(10);
      expect(entry.avoid.length).toBeGreaterThan(8);
    }
    for (const entry of absurdPrompts) {
      expect(entry.imagePrompt.length).toBeGreaterThan(30);
      expect(entry.videoBeat.length).toBeGreaterThan(20);
      expect(entry.continuity.length).toBeGreaterThan(10);
      expect(entry.jokeMechanism.length).toBeGreaterThan(5);
    }
  });

  test("检索飞行汽车优先返回相关原创模板，不强塞全库", () => {
    const results = searchCreativeKnowledge({ library: "absurd", query: "飞行", tags: [], limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.library).toBe("absurd");
    expect(results.some(result => result.title.includes("飞行汽车"))).toBe(true);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  test("按热梗关键词查询返回明确证据范围，不能宣称全网趋势", () => {
    const results = searchCreativeKnowledge({ library: "memes", query: "胆子真是肥嘟嘟的", tags: [], limit: 3 });
    expect(results[0]?.title).toBe("胆子真是肥嘟嘟的");
    const match = results[0]?.details;
    expect(match && "sourceUrl" in match && match.sourceUrl).toContain("geng8.com");
    expect(match && "evidence" in match && match.evidence).toBe("site-observation");
  });

  test("关键词/标签都不相关时返回空结果，不编造流行语", () => {
    expect(searchCreativeKnowledge({ library: "memes", query: "不存在的宇宙果冻号", tags: [], limit: 6 })).toEqual([]);
    expect(searchCreativeKnowledge({ library: "absurd", query: "", tags: ["不存在的类别"], limit: 6 })).toEqual([]);
  });

  test("只提供标签时按场景检索，严格遵守 limit", () => {
    const results = searchCreativeKnowledge({ library: "all", query: "", tags: ["职场"], limit: 4 });
    expect(results.length).toBe(4);
    expect(results.every(item => item.tags.includes("职场"))).toBe(true);
  });

  test("工具使用 list/search，结果只读，不生成或写画布", async () => {
    const tool = createCreativeKnowledgeSearchTool();
    expect(tool.name).toBe("searchCreativeKnowledge");
    const listed = await tool.execute("t", { action: "list" }, new AbortController().signal);
    expect(JSON.stringify(listed.details)).toContain("memes");
    const found = await tool.execute("t", { action: "search", library: "absurd", query: "机甲", limit: 2 }, new AbortController().signal);
    expect(JSON.stringify(found.details)).toContain("matches");
  });
});
