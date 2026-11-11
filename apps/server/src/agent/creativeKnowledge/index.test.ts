import { describe, expect, test } from "bun:test";
import { searchCreativeKnowledge } from "./index";
import { createVideoTemplateSearchTool } from "@/agent/videoPrompt/templates";
import { memesCN } from "./memesCN";
import { absurdPrompts } from "./absurdPrompts";
import { expressionTemplates } from "./expressionTemplates";
import { visualStyles } from "./visualStyles";

const signal = new AbortController().signal;

describe("创作知识库：热梗、搞怪、表情与画风", () => {
  test("热梗均为2026有日期的公开记录，无2025条目或不明确的热门来源", () => {
    expect(memesCN.length).toBeGreaterThanOrEqual(33);
    expect(absurdPrompts.length).toBeGreaterThanOrEqual(20);
    const all = [...memesCN, ...absurdPrompts, ...expressionTemplates, ...visualStyles];
    expect(new Set(all.map(x => x.id)).size).toBe(all.length);
    for (const item of memesCN) {
      expect(item.observedAt).toMatch(/^2026-\d\d-\d\d$/);
      expect(item.period).toContain("2026");
      expect(item.sourceLabel).toContain("2026");
      expect(item.sourceUrl.startsWith("https://")).toBe(true);
      expect(["2026-dated-entry", "2026-press-roundup"]).toContain(item.evidence);
      expect(item.meaning.length).toBeGreaterThan(10);
      expect(item.usage.length).toBeGreaterThan(10);
      expect(item.avoid.length).toBeGreaterThan(8);
    }
  });

  test("抽象图库的动作、机位、连续性与原创笑点不退化成热梗列表", () => {
    for (const item of absurdPrompts) {
      expect(item.imagePrompt.length).toBeGreaterThan(30);
      expect(item.videoBeat.length).toBeGreaterThan(20);
      expect(item.continuity.length).toBeGreaterThan(10);
      expect(item.jokeMechanism.length).toBeGreaterThan(5);
    }
  });

  test("分类检索飞行汽车返回对应原创模板而不灌入全库", () => {
    const found = searchCreativeKnowledge({ library: "absurd", query: "飞行", tags: [], limit: 5 });
    expect(found.length).toBeGreaterThan(0);
    expect(found.some(item => item.title.includes("飞行汽车"))).toBe(true);
    expect(found.length).toBeLessThanOrEqual(5);
  });

  test("热梗具有2026记录时间及来源，不冒充全网实时榜", () => {
    const result = searchCreativeKnowledge({ library: "memes", query: "大水理论", tags: [], limit: 3 });
    expect(result[0]?.title).toBe("大水理论");
    const entry = result[0]?.details;
    expect(entry && "sourceUrl" in entry && entry.sourceUrl).toContain("ssmys.com");
    expect(entry && "evidence" in entry && entry.evidence).toBe("2026-dated-entry");
    expect(entry && "observedAt" in entry && entry.observedAt).toBe("2026-10-05");
  });

  test("不相关的关键词/标签返回空，不编造流行语", () => {
    expect(searchCreativeKnowledge({ library: "memes", query: "不存在的宇宙果冻号", tags: [], limit: 5 })).toEqual([]);
    expect(searchCreativeKnowledge({ library: "absurd", query: "", tags: ["不存在的类别"], limit: 5 })).toEqual([]);
  });

  test("查询只匹配已存在的标签并严格限制返回条数", () => {
    const results = searchCreativeKnowledge({ library: "all", query: "", tags: ["职场"], limit: 4 });
    expect(results).toHaveLength(4);
    expect(results.every(item => item.tags.includes("职场"))).toBe(true);
  });

  test("合并后的唯一工具保留原视频模板 listTags/search 两个接口", async () => {
    const tool = createVideoTemplateSearchTool();
    expect(tool.name).toBe("searchVideoPromptTemplates");
    const tags = await tool.execute("t", { action: "listTags" }, signal, undefined, undefined as never);
    expect(JSON.stringify(tags.details)).toContain("机械变形");
    const searched = await tool.execute("t", { action: "search", tags: { scene: ["机械变形"] }, limit: 2 }, signal, undefined, undefined as never);
    expect(JSON.stringify(searched.details)).toContain("templates");
  });

  test("同一个分类检索工具新增 listCreativeTags/searchCreative，按2026档期搜索", async () => {
    const tool = createVideoTemplateSearchTool();
    const listed = await tool.execute("t", { action: "listCreativeTags" }, signal, undefined, undefined as never);
    expect(JSON.stringify(listed.details)).toContain("2026中国网络热梗");
    expect(JSON.stringify(listed.details)).toContain("原创抽象搞怪");
    const searched = await tool.execute("t", { action: "searchCreative", library: "memes", query: "宿命对视", limit: 2 }, signal, undefined, undefined as never);
    const json = JSON.stringify(searched.details);
    expect(json).toContain("宿命对视");
    expect(json).toContain("2026-10-12");
  });

  test("DeepSeek蓝色大肥鱼归因准确，新增比比拉布、我的刀盾、嘉豪有2026来源", () => {
    const fish = memesCN.find(item => item.id === "m26-bluefish");
    expect(fish?.meaning).toContain("DeepSeek");
    expect(fish?.avoid).toContain("非官方");
    for (const name of ["比比拉布", "我的刀盾", "嘉豪文学"]) {
      const found = memesCN.find(item => item.phrase === name);
      expect(found?.sourceUrl.startsWith("https://")).toBe(true);
      expect(found?.observedAt.startsWith("2026-")).toBe(true);
    }
    expect(memesCN.find(item => item.phrase === "嘉豪文学")?.avoid).toContain("真实同名者");
  });

  test("表情按常规/搞怪/极夸张/抽象四类检索，字段能驱动连续表演", () => {
    expect(expressionTemplates).toHaveLength(38);
    for (const category of ["basic", "funny", "extreme", "abstract"]) {
      const group = expressionTemplates.filter(item => item.category === category);
      expect(group.length).toBeGreaterThanOrEqual(8);
      for (const item of group) {
        expect(item.face.length).toBeGreaterThan(6);
        expect(item.gesture.length).toBeGreaterThan(5);
        expect(item.videoBeat.includes("→")).toBe(true);
        expect(item.imagePrompt).toContain("保持原角色");
        expect(item.continuity).toContain("身份");
      }
    }
    const result = searchCreativeKnowledge({ library: "expressions", query: "瞳孔地震", tags: [], limit: 3 });
    expect(result[0]?.title).toBe("瞳孔地震");
    expect(result.every(x => x.library === "expressions")).toBe(true);
  });

  test("画风和滤镜有独立类型及可执行提示词，标签与交叉检索兼容", () => {
    expect(visualStyles).toHaveLength(48);
    expect(visualStyles.filter(item => item.category === "style")).toHaveLength(32);
    expect(visualStyles.filter(item => item.category === "filter")).toHaveLength(16);
    for (const item of visualStyles) {
      expect(item.imagePrompt.length).toBeGreaterThan(30);
      expect(item.videoPrompt).toContain("连续镜头");
      expect(item.avoid.length).toBeGreaterThan(15);
    }
    expect(searchCreativeKnowledge({library:"styles",query:"电影级写实",tags:[],limit:2})[0]?.title).toBe("电影级写实");
    const filters = searchCreativeKnowledge({library:"styles",query:"胶片",tags:["滤镜"],limit:10});
    expect(filters.length).toBeGreaterThan(0);
    expect(filters.every(item => item.library === "styles" && item.tags.includes("滤镜"))).toBe(true);
    const all = searchCreativeKnowledge({library:"all",query:"",tags:["抽象表情"],limit:10});
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(item => item.library === "expressions")).toBe(true);
  });

  test("统一工具可查询新分类，旧 listTags/search 不退化", async () => {
    const tool = createVideoTemplateSearchTool();
    const listed = await tool.execute("t",{action:"listCreativeTags"},signal,undefined,undefined as never);
    const text = JSON.stringify(listed.details);
    expect(text).toContain("人物表情与颜艺模板");
    expect(text).toContain("画风与滤镜模板");
    for (const [library, query] of [["expressions","憋笑失败"],["styles","青橙电影调色"],["memes","比比拉布"]] as const) {
      const result = await tool.execute("t",{action:"searchCreative",library,query,limit:3},signal,undefined,undefined as never);
      expect(JSON.stringify(result.details)).toContain(query);
    }
  });

});
