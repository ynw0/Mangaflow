/** 按需检索的创作知识数据层：保留现有统一 Agent 工具 searchVideoPromptTemplates。 */
import { memesCN } from "@/agent/creativeKnowledge/memesCN";
import { absurdPrompts } from "@/agent/creativeKnowledge/absurdPrompts";
import { expressionTemplates } from "@/agent/creativeKnowledge/expressionTemplates";
import { visualStyles } from "@/agent/creativeKnowledge/visualStyles";

export type CreativeLibrary = "memes" | "absurd" | "expressions" | "styles" | "all";
export type CreativeSearchOptions = { library: CreativeLibrary; query: string; tags: string[]; limit: number };

export type CreativeSearchResult = {
  library: Exclude<CreativeLibrary, "all">;
  id: string;
  title: string;
  tags: string[];
  score: number;
  observedAt?: string;
  details: (typeof memesCN)[number] | (typeof absurdPrompts)[number] | (typeof expressionTemplates)[number] | (typeof visualStyles)[number];
};

function matchingScore(title: string, tags: string[], content: string, query: string, requestedTags: string[]): number {
  const terms = query.toLowerCase().split(/[\s,，、;；]+/).map(x => x.trim()).filter(Boolean);
  const name = title.toLowerCase();
  const ownTags = tags.map(x => x.toLowerCase());
  const body = content.toLowerCase();
  const matchedTags = requestedTags.filter(tag => ownTags.some(value => value.includes(tag.toLowerCase())));
  if (requestedTags.length && !matchedTags.length) return 0;
  const termScore = terms.reduce((score, term) =>
    score + (name.includes(term) ? 8 : 0) + (ownTags.some(tag => tag.includes(term)) ? 5 : 0) + (body.includes(term) ? 1 : 0), 0);
  if (terms.length && !termScore && !matchedTags.length) return 0;
  return termScore + matchedTags.length * 5 + (terms.length || requestedTags.length ? 0 : 1);
}

const categoryTags = (items: readonly { tags: string[] }[]) => [...new Set(items.flatMap(x => x.tags))].sort();
export function listCreativeKnowledgeCategories() {
  return {
    asOf: "2026-11-11",
    categories: [
      { id: "memes", title: "2026网络热梗与二创文化", count: memesCN.length,
        tags: categoryTags(memesCN), observedFrom: "2026-05-08", observedThrough: "2026-11-11",
        caveat: "2026年有日期的公开记录，不保证词语起源于2026年；不是实时热榜；真实二创形象须尊重版权和人物。"},
      { id: "absurd", title: "原创抽象搞怪剧情/镜头", count: absurdPrompts.length,
        tags: categoryTags(absurdPrompts), caveat: "原创喜剧构思，需要改写成具体镜头提示词。"},
      { id: "expressions", title: "人物表情与颜艺模板", count: expressionTemplates.length,
        tags: categoryTags(expressionTemplates), groups: ["basic", "funny", "extreme", "abstract"],
        caveat: "常规、搞怪、极夸张与抽象；保留角色面部结构及已确认的身份。"},
      { id: "styles", title: "画风与滤镜模板", count: visualStyles.length,
        tags: categoryTags(visualStyles), groups: ["style", "filter"],
        caveat: "可组合的提示词视觉语言；滤镜不表示已执行真实 LUT/后期处理。"},
    ],
  };
}

export function searchCreativeKnowledge(options: CreativeSearchOptions): CreativeSearchResult[] {
  const limit = Math.max(1, Math.min(10, options.limit));
  const results: CreativeSearchResult[] = [];
  const wants = (library: CreativeSearchResult["library"]) => options.library === "all" || options.library === library;
  const add = (library: CreativeSearchResult["library"], id: string, title: string, tags: string[], content: string,
    details: CreativeSearchResult["details"], observedAt?: string) => {
    const score = matchingScore(title, tags, content, options.query, options.tags);
    if (score > 0) results.push({ library, id, title, tags, score, ...(observedAt ? { observedAt } : {}), details });
  };
  if (wants("memes")) for (const item of memesCN)
    add("memes", item.id, item.phrase, item.tags, [item.meaning, item.usage].join(" "), item, item.observedAt);
  if (wants("absurd")) for (const item of absurdPrompts)
    add("absurd", item.id, item.title, item.tags, [item.setup, item.imagePrompt, item.videoBeat, item.jokeMechanism].join(" "), item);
  if (wants("expressions")) for (const item of expressionTemplates)
    add("expressions", item.id, item.title, item.tags, [item.face, item.gesture, item.imagePrompt, item.videoBeat, item.category].join(" "), item);
  if (wants("styles")) for (const item of visualStyles)
    add("styles", item.id, item.title, item.tags, [item.group, item.imagePrompt, item.videoPrompt, item.palette, item.lighting].join(" "), item);
  return results.sort((a,b) => b.score - a.score
    || (b.observedAt ?? "").localeCompare(a.observedAt ?? "")
    || a.id.localeCompare(b.id)).slice(0,limit);
}
