/** 分类检索的数据层：复用 searchVideoPromptTemplates 的工具入口，避免重复创建 Agent 工具。 */
import { memesCN } from "@/agent/creativeKnowledge/memesCN";
import { absurdPrompts } from "@/agent/creativeKnowledge/absurdPrompts";

export type CreativeLibrary = "memes" | "absurd" | "all";
export type CreativeSearchOptions = { library: CreativeLibrary; query: string; tags: string[]; limit: number };

export type CreativeSearchResult = {
  library: "memes" | "absurd";
  id: string;
  title: string;
  tags: string[];
  score: number;
  observedAt?: string;
  details: (typeof memesCN)[number] | (typeof absurdPrompts)[number];
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

export function listCreativeKnowledgeCategories() {
  return {
    asOf: "2026-11-11",
    categories: [
      {
        id: "memes", title: "2026中国网络热梗",
        count: memesCN.length,
        tags: [...new Set(memesCN.flatMap(x => x.tags))].sort(),
        observedFrom: "2026-07-01", observedThrough: "2026-11-11",
        caveat: "2026年有日期的公开记录，不保证词语首次发明于2026年；不是实时全网热度排行。",
      },
      {
        id: "absurd", title: "原创抽象搞怪图片/视频拍法",
        count: absurdPrompts.length,
        tags: [...new Set(absurdPrompts.flatMap(x => x.tags))].sort(),
        caveat: "原创构思模板，不是已生成验证的作品；执行时按当前工作流与镜头合同改写。",
      },
    ],
  };
}

export function searchCreativeKnowledge(options: CreativeSearchOptions): CreativeSearchResult[] {
  const limit = Math.max(1, Math.min(10, options.limit));
  const results: CreativeSearchResult[] = [];
  if (options.library !== "absurd") {
    for (const entry of memesCN) {
      const score = matchingScore(entry.phrase, entry.tags, [entry.meaning, entry.usage].join(" "), options.query, options.tags);
      if (score > 0) results.push({ library: "memes", id: entry.id, title: entry.phrase, tags: entry.tags, score, observedAt: entry.observedAt, details: entry });
    }
  }
  if (options.library !== "memes") {
    for (const entry of absurdPrompts) {
      const score = matchingScore(entry.title, entry.tags,
        [entry.setup, entry.imagePrompt, entry.videoBeat, entry.jokeMechanism].join(" "), options.query, options.tags);
      if (score > 0) results.push({ library: "absurd", id: entry.id, title: entry.title, tags: entry.tags, score, details: entry });
    }
  }
  return results.sort((a, b) => b.score - a.score
    || (b.observedAt ?? "").localeCompare(a.observedAt ?? "")
    || a.id.localeCompare(b.id)).slice(0, limit);
}
