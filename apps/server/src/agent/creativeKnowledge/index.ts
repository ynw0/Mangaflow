/** 创作知识统一数据层：按需精确检索，不替代已有导演镜头工具与 H3 审核。 */
import { memesCN } from "@/agent/creativeKnowledge/memesCN";
import { absurdPrompts } from "@/agent/creativeKnowledge/absurdPrompts";
import { expressionTemplates } from "@/agent/creativeKnowledge/expressionTemplates";
import { visualStyles } from "@/agent/creativeKnowledge/visualStyles";
import { narrativeTemplates } from "@/agent/creativeKnowledge/narrativeTemplates";

export type CreativeLibrary = "memes" | "absurd" | "expressions" | "styles" | "narrative" | "all";
export type CreativeSearchOptions = { library: CreativeLibrary; query: string; tags: string[]; limit: number };
type CreativeDetails =
  | (typeof memesCN)[number]
  | (typeof absurdPrompts)[number]
  | (typeof expressionTemplates)[number]
  | (typeof visualStyles)[number]
  | (typeof narrativeTemplates)[number];
export type CreativeSearchResult = {
  library: Exclude<CreativeLibrary, "all">;
  id: string;
  title: string;
  tags: string[];
  score: number;
  observedAt?: string;
  details: CreativeDetails;
};

/** 查询词均需被解释，标签均需命中；不再因为一个宽泛标签召回全部不相关风格。 */
function matchingScore(title: string, aliases: string[], tags: string[], content: string, query: string, requestedTags: string[]): number {
  const name = title.toLocaleLowerCase();
  const knownAliases = aliases.map(a => a.toLocaleLowerCase());
  const ownTags = tags.map(tag => tag.toLocaleLowerCase());
  const body = content.toLocaleLowerCase();
  const requested = [...new Set(requestedTags.map(tag => tag.toLocaleLowerCase().trim()).filter(Boolean))];
  if (requested.some(tag => !ownTags.some(value => value === tag || value.includes(tag)))) return 0;
  const wholeQuery = query.toLocaleLowerCase().trim();
  const terms = [...new Set(wholeQuery.split(/[\s,，、;；]+/).filter(Boolean))];
  if (terms.some(term => !name.includes(term)
      && !knownAliases.some(alias => alias.includes(term))
      && !ownTags.some(tag => tag.includes(term))
      && !body.includes(term))) return 0;
  if (!terms.length && !requested.length) return 1;
  const wholeMatch = wholeQuery === name ? 60 : knownAliases.includes(wholeQuery) ? 55
    : name.includes(wholeQuery) && wholeQuery.length ? 25 : 0;
  return wholeMatch + requested.length * 9 + terms.reduce((score, term) =>
    score + (name.includes(term) ? 14 : 0)
      + (knownAliases.some(alias => alias.includes(term)) ? 12 : 0)
      + (ownTags.some(tag => tag.includes(term)) ? 5 : 0)
      + (body.includes(term) ? 1 : 0), 0);
}
const categoryTags = (items: readonly { tags: string[] }[]) => [...new Set(items.flatMap(x => x.tags))].sort();

export function listCreativeKnowledgeCategories() {
  return {
    asOf: "2026-11-11",
    categories: [
      { id: "memes", title: "2026网络热梗与二创文化", count: memesCN.length,
        tags: categoryTags(memesCN), observedFrom: "2026-05-08", observedThrough: "2026-11-11",
        caveat: "公开日期只证明2026年有传播记录，不等于首发日期或实时全网排名，勿复刻未授权原视频/真人音色。"},
      { id: "absurd", title: "原创抽象搞怪剧情/镜头", count: absurdPrompts.length,
        tags: categoryTags(absurdPrompts), caveat: "单镜构思必须符合剧情、时长与参考资产，不直接变成 H3 提示词。"},
      { id: "expressions", title: "人物表情与颜艺模板", count: expressionTemplates.length,
        tags: categoryTags(expressionTemplates), groups: ["basic", "funny", "extreme", "abstract"],
        caveat: "身份和五官结构固定；写实片中极夸张颜艺只能放大表演，不默认改成卡通变形。"},
      { id: "styles", title: "画风与滤镜模板", count: visualStyles.length,
        tags: categoryTags(visualStyles), groups: ["style", "filter"],
        caveat: "主画风与滤镜分层组合，提示词只是视觉建议，不等于真实 LUT 或后期滤镜执行。"},
      { id: "narrative", title: "叙事结构与剧情节拍模板", count: narrativeTemplates.length,
        tags: categoryTags(narrativeTemplates), groups: ["hook","establish","conflict","reveal","choice","payoff","aftermath"],
        caveat: "scene 是跨多个镜头的剧情结构，不能塞进一个 H3 连续镜头；shot 才可作为单镜草案。"},
    ],
  };
}

export function searchCreativeKnowledge(options: CreativeSearchOptions): CreativeSearchResult[] {
  const limit = Math.max(1, Math.min(10, Number.isFinite(options.limit) ? options.limit : 5));
  const results: CreativeSearchResult[] = [];
  const wants = (library: CreativeSearchResult["library"]) => options.library === "all" || options.library === library;
  const add = (library: CreativeSearchResult["library"], id: string, title: string, aliases: string[], tags: string[], content: string,
    details: CreativeDetails, observedAt?: string) => {
    const score = matchingScore(title, aliases, tags, content, options.query, options.tags);
    if (score > 0) results.push({ library, id, title, tags, score, ...(observedAt ? { observedAt } : {}), details });
  };
  if (wants("memes")) for (const item of memesCN)
    add("memes", item.id, item.phrase, item.aliases ?? [], item.tags,
      [item.meaning, item.usage].join(" "), item, item.observedAt);
  if (wants("absurd")) for (const item of absurdPrompts)
    add("absurd", item.id, item.title, [], item.tags,
      [item.setup, item.imagePrompt, item.videoBeat, item.jokeMechanism].join(" "), item);
  if (wants("expressions")) for (const item of expressionTemplates)
    add("expressions", item.id, item.title, [], item.tags,
      [item.face, item.gesture, item.imagePrompt, item.videoBeat, item.category].join(" "), item);
  if (wants("styles")) for (const item of visualStyles)
    add("styles", item.id, item.title, [], item.tags,
      [item.group, item.imagePrompt, item.videoPrompt, item.palette, item.lighting].join(" "), item);
  if (wants("narrative")) for (const item of narrativeTemplates)
    add("narrative", item.id, item.title, [], item.tags,
      [item.purpose,item.setup,item.escalation,item.visibleResult,item.shotGuidance].join(" "), item);
  return results.sort((a,b) => b.score - a.score
    || (b.observedAt ?? "").localeCompare(a.observedAt ?? "")
    || a.id.localeCompare(b.id)).slice(0,limit);
}

export type CreativeSelection = {
  narrativeId?: string;
  expressionId?: string;
  styleId?: string;
  filterId?: string;
  absurdId?: string;
  memeId?: string;
};
export type CreativeSelectionOptions = {
  selected: CreativeSelection;
  medium: "image" | "video";
  tone: "neutral" | "serious" | "comedy";
  durationSeconds?: number;
};

/** 只读检查已选模板，发现冲突时要求 Agent 做取舍，不进行 AI 生成或自动修改合同。 */
export function checkCreativeSelection(options: CreativeSelectionOptions) {
  const { selected } = options;
  const errors: string[] = [], warnings: string[] = [];
  function pick<T extends { id: string; title: string }>(id: string | undefined, items: readonly T[], slot: string): T | undefined {
    if (!id) return undefined;
    const found = items.find(item => item.id === id);
    if (!found) errors.push(`${slot} 指向不存在的模板 ID：${id}`);
    return found;
  }
  const narrative = pick(selected.narrativeId,narrativeTemplates,"narrativeId");
  const expression = pick(selected.expressionId,expressionTemplates,"expressionId");
  const style = pick(selected.styleId,visualStyles.filter(item => item.category === "style"),"styleId");
  const filter = pick(selected.filterId,visualStyles.filter(item => item.category === "filter"),"filterId");
  const absurd = pick(selected.absurdId,absurdPrompts,"absurdId");
  const meme = pick(selected.memeId,memesCN,"memeId");

  if (narrative && options.medium === "video" && options.durationSeconds !== undefined && narrative.minSeconds > options.durationSeconds) {
    warnings.push(`「${narrative.title}」至少按${narrative.minSeconds}s规划；当前${options.durationSeconds}s无法容纳完整结构，应拆分镜头或改用单镜模板，不可删情节。`);
  }
  if (narrative?.scope === "scene" && options.medium === "video") {
    warnings.push(`「${narrative.title}」是多镜场次结构，不得作为单个 H3 连续镜头直接执行。`);
  }
  if (expression?.category === "extreme" && style?.group === "影视写实") {
    warnings.push("写实主画风与极夸张颜艺需收束到可见的眉眼嘴和身体反应，不应使脸型、骨骼或身份突变。");
  }
  if (options.tone === "serious" && (absurd || meme)) {
    warnings.push("用户要求严肃基调，却选择了热梗/搞怪模板；除非当前镜头明确需要喜剧，否则不要注入。");
  }
  if (filter && !style) warnings.push("只选择滤镜而无项目已批准主画风；保留项目原画风，不从滤镜推断新人物造型。");
  if (meme) warnings.push("热梗仅作文化参考：保留来源/日期，避免原录音、未授权IP形象和对真实人物的攻击。");

  return {
    status: errors.length ? "invalid" : warnings.length ? "review" : "ok",
    errors,warnings,
    selected: [
      narrative && {slot:"narrative",id:narrative.id,title:narrative.title,scope:narrative.scope,visibleResult:narrative.visibleResult,verify:narrative.verify},
      expression && {slot:"expression",id:expression.id,title:expression.title,face:expression.face,gesture:expression.gesture},
      style && {slot:"style",id:style.id,title:style.title,look:style.imagePrompt},
      filter && {slot:"filter",id:filter.id,title:filter.title,look:filter.imagePrompt},
      absurd && {slot:"absurd",id:absurd.id,title:absurd.title,jokeMechanism:absurd.jokeMechanism},
      meme && {slot:"meme",id:meme.id,title:meme.phrase,sourceUrl:meme.sourceUrl,avoid:meme.avoid},
    ].filter(Boolean),
    guidance: "先遵守剧本合同、已批准的主画风和参考图；用少量可观察的动作/表情/构图信息重写，不直接拼接模板全文。视频每次只有一个连续镜头，最终提示词交由 H3 专用流程与独立审核生成。",
  };
}
