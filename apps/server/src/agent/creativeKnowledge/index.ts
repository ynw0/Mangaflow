/** 创作知识统一数据层：按需精确检索，不替代已有导演镜头工具与 H3 审核。 */
import { memesCN } from "@/agent/creativeKnowledge/memesCN";
import { absurdPrompts } from "@/agent/creativeKnowledge/absurdPrompts";
import { expressionTemplates } from "@/agent/creativeKnowledge/expressionTemplates";
import { visualStyles } from "@/agent/creativeKnowledge/visualStyles";
import { narrativeTemplates } from "@/agent/creativeKnowledge/narrativeTemplates";
import { voiceCategories, voiceTemplates } from "@/agent/creativeKnowledge/voiceTemplates";

export type CreativeLibrary = "memes" | "absurd" | "expressions" | "styles" | "narrative" | "voices" | "all";
export type CreativeSearchOptions = { library: CreativeLibrary; query: string; tags: string[]; limit: number };
type AbsurdPublic = Pick<(typeof absurdPrompts)[number], "id" | "title" | "tags" | "setup" | "jokeSkeleton" | "jokeMechanism" | "avoid">;
type ExpressionPublic = Omit<(typeof expressionTemplates)[number], "imagePrompt">;
type CreativeDetails =
  | (typeof memesCN)[number]
  | AbsurdPublic
  | ExpressionPublic
  | (typeof visualStyles)[number]
  | (typeof narrativeTemplates)[number]
  | (typeof voiceTemplates)[number];
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

/** 检索对外细节：去掉可整段粘贴的成品示范句，热梗保留 phrase 供编剧改写。 */
function publicDetails(library: CreativeSearchResult["library"], item: CreativeDetails): CreativeDetails {
  if (library === "absurd") {
    const absurd = item as (typeof absurdPrompts)[number];
    return {
      id: absurd.id, title: absurd.title, tags: absurd.tags, setup: absurd.setup,
      jokeSkeleton: absurd.jokeSkeleton, jokeMechanism: absurd.jokeMechanism, avoid: absurd.avoid,
    };
  }
  if (library === "expressions") {
    const expression = item as (typeof expressionTemplates)[number];
    return {
      id: expression.id, title: expression.title, category: expression.category, intensity: expression.intensity,
      tags: expression.tags, face: expression.face, gesture: expression.gesture, videoBeat: expression.videoBeat,
      camera: expression.camera, continuity: expression.continuity, avoid: expression.avoid,
    };
  }
  return item;
}

export function listCreativeKnowledgeCategories() {
  return {
    asOf: "2026-11-11",
    categories: [
      { id: "memes", title: "2026网络热梗与二创文化", count: memesCN.length,
        tags: categoryTags(memesCN), observedFrom: "2026-05-08", observedThrough: "2026-11-11",
        caveat: "有喜剧空间时适当写入剧本：借语气、空耳结构或反差机制，改写成符合人物身份与当场处境的原话；先让观众看见触发再出梗。勿把 phrase 原句当万能口头禅硬贴；严肃戏无喜剧空间时不要打断因果。勿复刻未授权原视频/真人音色。"},
      { id: "absurd", title: "原创抽象搞怪剧情/镜头", count: absurdPrompts.length,
        tags: categoryTags(absurdPrompts), caveat: "只取 jokeMechanism 与短骨架；单镜构思必须符合剧情、时长与参考资产，不直接变成 H3 提示词。"},
      { id: "expressions", title: "人物表情与颜艺模板", count: expressionTemplates.length,
        tags: categoryTags(expressionTemplates), groups: ["basic", "funny", "extreme", "abstract"],
        caveat: "只取 face/gesture/videoBeat；身份和五官结构固定；写实片中极夸张颜艺与机械卡顿表演须有剧本依据，否则不可用。"},
      { id: "styles", title: "画风与滤镜模板", count: visualStyles.length,
        tags: categoryTags(visualStyles), groups: ["style", "filter"],
        caveat: "主画风与滤镜分层组合；只输出可观测 look/lighting/palette/texture，不等于真实 LUT。"},
      { id: "narrative", title: "叙事结构与剧情节拍模板", count: narrativeTemplates.length,
        tags: categoryTags(narrativeTemplates), groups: ["hook","establish","conflict","reveal","choice","payoff","aftermath"],
        caveat: "scene 是多镜叙事模板，只有在用户允许切镜且时长足够时，才能编成一个 H3 视频片段；单镜合同需拆开或换模板。专属题材条目看 domains。"},
      { id: "voices", title: "H3 同期角色声音提示词模板", count: voiceTemplates.length,
        tags: categoryTags(voiceTemplates), groups: voiceCategories,
        caveat: "H3 同期合成声音；有对白时默认约正常语速的1.3倍。机械/合成音色限系统、广播或机器角色。口音和年龄感只是生成指导，不保证方言准确或声纹一致。"},
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
    if (score > 0) results.push({ library, id, title, tags, score, ...(observedAt ? { observedAt } : {}), details: publicDetails(library, details) });
  };
  if (wants("memes")) for (const item of memesCN)
    add("memes", item.id, item.phrase, item.aliases ?? [], item.tags,
      [item.meaning, item.usage].join(" "), item, item.observedAt);
  if (wants("absurd")) for (const item of absurdPrompts)
    add("absurd", item.id, item.title, [], item.tags,
      [item.setup, item.jokeSkeleton, item.videoBeat, item.jokeMechanism].join(" "), item);
  if (wants("expressions")) for (const item of expressionTemplates)
    add("expressions", item.id, item.title, [], item.tags,
      [item.face, item.gesture, item.videoBeat, item.category].join(" "), item);
  if (wants("styles")) for (const item of visualStyles)
    add("styles", item.id, item.title, [], item.tags,
      [item.group, item.imagePrompt, item.videoPrompt, item.palette, item.lighting].join(" "), item);
  if (wants("narrative")) for (const item of narrativeTemplates)
    add("narrative", item.id, item.title, [], item.tags,
      [item.purpose,item.setup,item.escalation,item.visibleResult,item.shotGuidance,(item.domains ?? []).join(" ")].join(" "), item);
  if (wants("voices")) for (const item of voiceTemplates)
    add("voices", item.id, item.title, [], item.tags,
      [item.descriptionZh, item.englishCue, item.category].join(" "), item);
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
export const creativeTones = ["neutral", "serious", "comedy"] as const;

export type CreativeSelectionOptions = {
  selected: CreativeSelection;
  medium: "image" | "video";
  tone?: (typeof creativeTones)[number];
  durationSeconds?: number;
  singleShot?: boolean;
  forDraft?: boolean;
  /** 调用方显式给出的题材域 */
  storyDomains?: string[];
};

/** 只读检查已选模板，发现冲突时要求 Agent 做取舍，不进行 AI 生成或自动修改合同。 */
export function checkCreativeSelection(options: CreativeSelectionOptions) {
  const { selected, forDraft } = options;
  const video = options.medium === "video";
  const errors: string[] = [], warnings: string[] = [];
  function pick<T extends { id: string }>(id: string | undefined, items: readonly T[], slot: string): T | undefined {
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

  // 分镜规划允许参考场次结构，进入单镜制作后按实际工作流时长拒绝不适用的模板。
  const narrativeIssues = options.singleShot ? errors : warnings;
  if (narrative && video && options.durationSeconds !== undefined && narrative.minSeconds > options.durationSeconds) {
    narrativeIssues.push(`「${narrative.title}」至少按${narrative.minSeconds}s规划；当前${options.durationSeconds}s无法容纳完整结构，应拆分镜头或改用单镜模板，不可删情节。`);
  }
  if (narrative?.scope === "scene" && video) {
    const reason = options.singleShot
      ? "当前合同要求连续单镜，请从本镜选择中移除这条模板，沿用定稿的事件"
      : "使用前须确认片段允许切镜、时长足够且不丢剧情";
    narrativeIssues.push(`「${narrative.title}」属于多镜场次结构。${reason}。`);
  }
  const explicitDomains = (options.storyDomains ?? []).map(item => item.toLocaleLowerCase());
  if (narrative?.domains?.length && explicitDomains.length) {
    const fits = narrative.domains.some(domain => explicitDomains.some(item => item === domain.toLocaleLowerCase() || item.includes(domain.toLocaleLowerCase())));
    if (!fits) warnings.push(`「${narrative.purpose}」面向 ${narrative.domains.join("/")}；已给题材域对不上。关键词对不上不拒绝出稿。`);
  }
  if (expression && (expression.category === "extreme" || expression.category === "abstract") && style?.group === "影视写实") {
    warnings.push("写实画风选了夸张或抽象颜艺。按人物此刻真正能看见、听见的变化取自然反应，停格、跳变或机械动作须以定稿为准。");
  }
  if (options.tone === "serious" && absurd) {
    warnings.push("用户要求严肃基调，却选择了搞怪模板；除非当前镜头明确需要喜剧，否则不要注入。");
  }
  if (options.tone === "serious" && meme) {
    warnings.push("严肃基调选了热梗：须先确认本镜有喜剧空间；若有，把梗核改写成该人物当场会说的话，勿原句硬贴；无喜剧空间则移除。");
  } else if (meme && options.tone !== "comedy") {
    warnings.push("热梗入戏前确认有喜剧空间；改写成角色原话，先让观众看见触发再出梗。");
  }
  if (filter && !style) warnings.push("只选择滤镜而无项目已批准主画风；保留项目原画风，不从滤镜推断新人物造型。");
  if (meme) warnings.push("热梗仅作文化参考：保留来源/日期，避免原录音、未授权IP形象和对真实人物的攻击。phrase 供编剧改写，成片 H3 只照录已锁定台词。");
  if (forDraft && absurd) warnings.push("搞怪示例留在构思阶段。视频稿的笑点、事件和对白从已确认的分镜取；只取机制与短骨架，勿整段粘贴。");
  if (forDraft && meme) warnings.push("热梗已选：在剧本对白中改写成人物原话后再锁定；导演成片阶段不再另贴库内原句。");

  const visualSummary = (item: (typeof visualStyles)[number] | undefined) => item && {
    slot: item.category, id: item.id, title: item.title,
    look: video ? item.videoPrompt : item.imagePrompt, avoid: item.avoid,
  };
  return {
    status: errors.length ? "invalid" : warnings.length ? "review" : "ok",
    errors, warnings,
    selected: [
      // 成片已有分镜合同，只传叙事目的和验收问题，具体示范留在构思阶段；摘要不带 title。
      narrative && {
        slot: "narrative", id: narrative.id, scope: narrative.scope, purpose: narrative.purpose, verify: narrative.verify,
        ...(narrative.domains?.length ? { domains: narrative.domains } : {}),
        ...(!forDraft ? {
          setup: narrative.setup, escalation: narrative.escalation,
          visibleResult: narrative.visibleResult, shotGuidance: narrative.shotGuidance, avoid: narrative.avoid,
        } : {}),
      },
      expression && {
        slot: "expression", id: expression.id,
        face: expression.face, gesture: expression.gesture, avoid: expression.avoid,
        ...(!forDraft ? { intensity: expression.intensity } : {}),
        ...(video ? { videoBeat: expression.videoBeat, continuity: expression.continuity }
          : { imagePrompt: expression.imagePrompt }),
      },
      visualSummary(style),
      visualSummary(filter),
      !forDraft && absurd && {
        slot: "absurd", id: absurd.id, jokeMechanism: absurd.jokeMechanism, jokeSkeleton: absurd.jokeSkeleton, avoid: absurd.avoid,
        ...(!video ? { imagePrompt: absurd.imagePrompt } : {}),
      },
      !forDraft && meme && {
        slot: "meme", id: meme.id, phrase: meme.phrase, meaning: meme.meaning, usage: meme.usage, avoid: meme.avoid,
        sourceUrl: meme.sourceUrl, observedAt: meme.observedAt,
        rewriteRule: "有喜剧空间时写入剧本：借语气/空耳结构/反差机制，改写成该人物当场会说的话；先让观众看见触发再出梗。勿原句硬贴。",
      },
    ].filter(Boolean),
    guidance: "先看观众已经知道什么、这镜要让他们看懂什么。取用的条目只服务于分镜里已有的事。表演跟着人物实际看见、听见的内容和双方关系走。模板标题、范例和资料术语留在库里，正文用明确的人物、具体动作和寻常词语。网络热梗可在喜剧空间入戏，须改写成人物原话。切点、对白、画风和素材均以当前定稿为准。",
  };
}
