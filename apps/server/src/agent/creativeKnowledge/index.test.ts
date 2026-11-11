import { describe, expect, test } from "bun:test";
import { checkCreativeSelection, searchCreativeKnowledge } from "./index";
import { createVideoTemplateSearchTool } from "@/agent/videoPrompt/templates";
import { memesCN } from "./memesCN";
import { absurdPrompts } from "./absurdPrompts";
import { expressionTemplates } from "./expressionTemplates";
import { visualStyles } from "./visualStyles";
import { narrativeTemplates } from "./narrativeTemplates";

const signal = new AbortController().signal;

describe("创作知识库：热梗、搞怪、表情与画风", () => {
  test("热梗均为2026有日期的公开记录，无2025条目或不明确的热门来源", () => {
    expect(memesCN.length).toBeGreaterThanOrEqual(49);
    expect(absurdPrompts.length).toBeGreaterThanOrEqual(20);
    const all = [...memesCN, ...absurdPrompts, ...expressionTemplates, ...visualStyles, ...narrativeTemplates];
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
    expect(JSON.stringify(listed.details)).toContain("2026网络热梗与二创文化");
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
        expect(item.gesture.length).toBeGreaterThanOrEqual(5);
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


  test("我超威与 Chovy 空耳别名准确指向同一条，保留来源及人物边界", () => {
    const result = searchCreativeKnowledge({library:"memes",query:"我超威",tags:[],limit:4});
    expect(result[0]?.title).toBe("我超威");
    expect(result[0]?.observedAt).toBe("2026-08-21");
    const entry = memesCN.find(m => m.phrase === "我超威");
    expect(entry?.meaning).toContain("并非选手本人所说");
    expect(entry?.sourceUrl).toContain("digitaling.com");
    expect(entry?.aliases).toContain("我Chovy");
    const alias = searchCreativeKnowledge({library:"memes",query:"我 Chovy",tags:[],limit:3});
    expect(alias[0]?.id).toBe(entry?.id);
  });

  test("热梗扩充须有明确的传播日期和适用/禁用上下文，不能伪装最初首发", () => {
    for (const name of ["胆子真是肥嘟嘟的","野生狗奶","青梅牛马","中式DNA觉醒",
      "进城办事","豆包型人格","精神离职","低山臭水遇知音","蒸蚌","我要验牌","中国人会飞"]) {
      const item = memesCN.find(x => x.phrase === name);
      expect(item).toBeDefined();
      expect(item?.sourceUrl.startsWith("https://")).toBe(true);
      expect(item?.usage.length).toBeGreaterThan(10);
      expect(item?.avoid.length).toBeGreaterThan(10);
    }
    expect(memesCN.find(x=>x.phrase==="我要验牌")?.avoid).toContain("早于2026年");
    expect(memesCN.find(x=>x.phrase==="中国人会飞")?.avoid).toContain("原曲");
  });

  test("检索必须同时命中多个标签与所有查询词，标题/别名精准结果优先", () => {
    const exact = searchCreativeKnowledge({library:"memes",query:"我超威",tags:[],limit:3});
    expect(exact[0]?.title).toBe("我超威");
    expect(searchCreativeKnowledge({library:"styles",query:"胶片",tags:["滤镜","非实际标签"],limit:4})).toEqual([]);
    expect(searchCreativeKnowledge({library:"styles",query:"电影级写实 不存在的光源名",tags:[],limit:3})).toEqual([]);
    const filter = searchCreativeKnowledge({library:"styles",query:"胶片",tags:["滤镜"],limit:8});
    expect(filter.length).toBeGreaterThan(0);
    expect(filter.every(item=>item.tags.includes("滤镜"))).toBe(true);
  });

  test("叙事结构22套覆盖开场、冲突、揭示、选择、回报、余波，并区分单镜和多镜", () => {
    expect(narrativeTemplates).toHaveLength(22);
    const phases = new Set(narrativeTemplates.map(item=>item.phase));
    for (const phase of ["hook","establish","conflict","reveal","choice","payoff","aftermath"]) {
      expect(phases.has(phase as never)).toBe(true);
    }
    for (const item of narrativeTemplates) {
      expect(item.id.startsWith("n")).toBe(true);
      expect(item.setup.length).toBeGreaterThan(8);
      expect(item.escalation.length).toBeGreaterThan(8);
      expect(item.visibleResult.length).toBeGreaterThan(8);
      expect(item.verify.length).toBeGreaterThan(8);
      expect(item.avoid.length).toBeGreaterThan(8);
      expect(item.scope === "scene" || item.scope === "shot").toBe(true);
    }
    const searched = searchCreativeKnowledge({library:"narrative",query:"机械",tags:[],limit:5});
    expect(searched.length).toBeGreaterThan(0);
    expect(searched.some(x=>x.title.includes("机械"))).toBe(true);
  });

  test("模板组合检查阻止错误ID，识别写实颜艺、多镜压缩、严肃剧情强塞热梗", () => {
    const result = checkCreativeSelection({
      selected: {narrativeId:"n12",styleId:"s01",expressionId:"e21",memeId:"m26-chovy"},
      medium:"video",tone:"serious",durationSeconds:5,
    });
    expect(result.status).toBe("review");
    const notes = result.warnings.join(" ");
    expect(notes).toContain("不得作为单个 H3");
    expect(notes).toContain("至少按15s");
    expect(notes).toContain("颜艺");
    expect(notes).toContain("严肃基调");
    expect(notes).toContain("来源/日期");
    const invalid = checkCreativeSelection({
      selected: {styleId:"f01",expressionId:"does-not-exist"},
      medium:"image",tone:"neutral",
    });
    expect(invalid.status).toBe("invalid");
    expect(invalid.errors).toHaveLength(2);
    const valid = checkCreativeSelection({
      selected: {styleId:"s01",expressionId:"e02",narrativeId:"n01"},
      medium:"video",tone:"neutral",durationSeconds:5,
    });
    expect(valid.status).toBe("ok");
  });

  test("沿用统一工具查询 narrative 与检查组合，而不另建 Agent 工具", async () => {
    const tool = createVideoTemplateSearchTool();
    const list = await tool.execute("t",{action:"listCreativeTags"},signal,undefined,undefined as never);
    expect(JSON.stringify(list.details)).toContain("叙事结构与剧情节拍模板");
    const found = await tool.execute("t",{action:"searchCreative",library:"narrative",query:"系统觉醒",limit:2},signal,undefined,undefined as never);
    expect(JSON.stringify(found.details)).toContain("系统觉醒");
    const checked = await tool.execute("t",{action:"checkCreativeSelection",selected:{styleId:"s01",filterId:"f01",expressionId:"e02"},medium:"image"},signal,undefined,undefined as never);
    expect(checked.details).toHaveProperty("status","ok");
  });

});
