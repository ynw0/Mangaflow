import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { memesCN } from "@/agent/creativeKnowledge/memesCN";
import { absurdPrompts } from "@/agent/creativeKnowledge/absurdPrompts";

const searchParameters = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({
    action: z.literal("search"),
    library: z.enum(["memes", "absurd", "all"]).default("all"),
    query: z.string().trim().max(200).default(""),
    tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
    limit: z.number().int().min(1).max(10).default(5),
  }),
]);

type SearchInput = z.infer<typeof searchParameters>;
type SearchOptions = Extract<SearchInput, { action: "search" }>;

type SearchResult = {
  library: "memes" | "absurd";
  id: string;
  title: string;
  tags: string[];
  score: number;
  details: (typeof memesCN)[number] | (typeof absurdPrompts)[number];
};

function matchingScore(
  title: string, tags: string[], content: string,
  query: string, requestedTags: string[],
): number {
  const terms = query.toLowerCase().split(/[\s,，、;；]+/).map(x => x.trim()).filter(Boolean);
  const name = title.toLowerCase();
  const searchableTags = tags.map(x => x.toLowerCase());
  const body = content.toLowerCase();
  const matchedTags = requestedTags.filter(tag => searchableTags.some(value => value.includes(tag.toLowerCase())));
  if (requestedTags.length && !matchedTags.length) return 0;
  const termScore = terms.reduce((score, term) =>
    score + (name.includes(term) ? 8 : 0)
      + (searchableTags.some(tag => tag.includes(term)) ? 5 : 0)
      + (body.includes(term) ? 1 : 0), 0);
  if (terms.length && !termScore && !matchedTags.length) return 0;
  return termScore + matchedTags.length * 5 + (terms.length || requestedTags.length ? 0 : 1);
}

export function searchCreativeKnowledge(options: Omit<SearchOptions, "action">): SearchResult[] {
  const results: SearchResult[] = [];
  if (options.library !== "absurd") for (const entry of memesCN) {
    const score = matchingScore(entry.phrase, entry.tags, [entry.meaning, entry.usage].join(" "), options.query, options.tags);
    if (score > 0) results.push({ library: "memes", id: entry.id, title: entry.phrase, tags: entry.tags, score, details: entry });
  }
  if (options.library !== "memes") for (const entry of absurdPrompts) {
    const score = matchingScore(entry.title, entry.tags, [entry.setup, entry.imagePrompt, entry.videoBeat, entry.jokeMechanism].join(" "), options.query, options.tags);
    if (score > 0) results.push({ library: "absurd", id: entry.id, title: entry.title, tags: entry.tags, score, details: entry });
  }
  return results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, options.limit);
}

/** Read-only creative reference; never submits jobs and never changes canvas. */
export function createCreativeKnowledgeSearchTool(): ToolDefinition {
  return {
    name: "searchCreativeKnowledge",
    label: "搜索中国热梗与抽象搞怪提示词库",
    description: "从内置知识库按关键词/标签检索中国网络热梗与原创抽象搞怪的图片、视频拍法。list 返回库存；search 返回少量匹配项。2026热梗为注明日期的单站观察，非全网实时榜。不会改画布或执行生成。",
    promptSnippet: "只有创作涉及网络热梗、抽象喜剧、搞怪、反差、沙雕短剧或用户要求时按需调用 searchCreativeKnowledge；正常严肃短剧不强加热梗。",
    promptGuidelines: [
      "热梗资料包含观察日期、证据范围及来源；不能把单站访问榜包装成全网最新排行。过期、圈层不合时宁可不用。",
      "抽象模板仅为原创创意骨架，生成前应适配已定稿的人物和场景、画幅、单镜头动作、声音及审核合同；不得原样替代 H3 官方格式和工作流审核。",
      "检索不等于生成授权；需在当前画布上通过节点填写提示词、连线、生成与回读输出。仅明确聊天直出时使用对话生成工具。",
    ],
    parameters: z.toJSONSchema(searchParameters, { io: "input", target: "draft-07" }),
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      const input = searchParameters.parse(args);
      const result = input.action === "list"
        ? {
          libraries: [
            { id: "memes", count: memesCN.length, scope: "中国网络热梗，有来源日期与有限证据范围", observedAt: "2026-11-11" },
            { id: "absurd", count: absurdPrompts.length, scope: "原创抽象搞怪图像/视频提示词骨架", observedAt: "2026-11-11" },
          ],
          instructions: "先使用 search 并填关键词或标签；不要默认把全部素材注入严肃故事。",
        }
        : {
          matches: searchCreativeKnowledge(input),
          notice: "2026 年网络热梗为有日期的公开站点观察，不代表持续热度；原创视频模板需按当前节点和 H3 规则审核再生成。",
        };
      return { details: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  };
}
