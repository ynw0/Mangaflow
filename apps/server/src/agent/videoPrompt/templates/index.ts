import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { actionTemplates } from "@/agent/videoPrompt/templates/actionTemplates";
import { craftTemplates } from "@/agent/videoPrompt/templates/craftTemplates";
import { effectsTemplates } from "@/agent/videoPrompt/templates/effectsTemplates";
import { sceneTemplates } from "@/agent/videoPrompt/templates/sceneTemplates";
import { templateAnchors, templateConditions, templateFormats, templateTags, templateTagSchema } from "@/agent/videoPrompt/templates/schema";
import type { TemplateConditions, VideoPromptTags, VideoPromptTemplate } from "@/agent/videoPrompt/templates/schema";
import { checkCreativeSelection, creativeTones, listCreativeKnowledgeCategories, searchCreativeKnowledge } from "@/agent/creativeKnowledge";

const templates = [...sceneTemplates, ...actionTemplates, ...effectsTemplates, ...craftTemplates];
const weights: Record<keyof VideoPromptTags, number> = {
  scene: 6, emotion: 2, performance: 2, action: 4, effect: 4,
  camera: 2, composition: 2, lighting: 2, sound: 2, setting: 2,
};
const dimensions = Object.keys(templateTags) as (keyof VideoPromptTags)[];

function compatible(template: VideoPromptTemplate, conditions: TemplateConditions) {
  const { duration, format, imageCount, subjectCount, anchors } = conditions;
  return (duration === undefined || duration >= template.minSeconds)
    && (format === undefined || !template.formats || template.formats.includes(format))
    && (imageCount === undefined || imageCount >= (template.minImages ?? 0))
    && (subjectCount === undefined || subjectCount >= (template.minSubjects ?? 0))
    && (anchors === undefined || !template.anchors || template.anchors.every(anchor => anchors.includes(anchor)));
}

export function findVideoPromptTemplates(tags: VideoPromptTags, conditions: TemplateConditions = {}, limit = 4) {
  const sceneFilter = new Set<string>(tags.scene);
  // 以剧情用途收窄候选，其他维度各自多选并参与排序。限制单个维度的重复命中权重。
  return templates.flatMap(template => {
    if (!compatible(template, conditions) || (sceneFilter.size && !template.tags.scene?.some(scene => sceneFilter.has(scene)))) return [];
    const matches = dimensions.flatMap(dimension => {
      const own = new Set<string>(template.tags[dimension]);
      const values = [...new Set<string>(tags[dimension])].filter(value => own.has(value));
      return values.length ? [{ dimension, values }] : [];
    });
    if (!matches.length) return [];
    const score = matches.reduce((total, { dimension, values }) => total + weights[dimension] + Math.min(1, values.length - 1), 0);
    return [{ ...template, score, matches }];
  }).sort((left, right) => right.score - left.score || right.matches.length - left.matches.length || (left.id < right.id ? -1 : 1)).slice(0, limit);
}

const searchFields = {
  tags: templateTagSchema.describe("search 必填。每次只填一个维度，数组内只填一个标签"),
  conditions: templateConditions.describe("search 可选：镜头时长与画面条件"),
  library: z.enum(["memes", "absurd", "expressions", "styles", "narrative", "voices", "all"]).describe("searchCreative 可选：创作知识库类别"),
  query: z.string().trim().max(200).describe("searchCreative 可选：检索关键词"),
  creativeTags: z.array(z.string().trim().min(1).max(24)).max(8).describe("searchCreative 按标签检索时只填一项。按名称查找时用 query"),
  limit: z.number().int().min(1).max(10).describe("search 可传 1–5，searchCreative 可传 1–10"),
  selected: z.strictObject({
    narrativeId: z.string().trim().min(1).max(40).optional(),
    expressionId: z.string().trim().min(1).max(40).optional(),
    styleId: z.string().trim().min(1).max(40).optional(),
    filterId: z.string().trim().min(1).max(40).optional(),
    absurdId: z.string().trim().min(1).max(40).optional(),
    memeId: z.string().trim().min(1).max(40).optional(),
  }).describe("checkCreativeSelection 必填：所选模板 ID"),
  medium: z.enum(["image", "video"]).describe("checkCreativeSelection 可选：制作媒介"),
  tone: z.enum(creativeTones).describe("checkCreativeSelection 可选：镜头基调"),
  durationSeconds: z.number().positive().max(300).describe("checkCreativeSelection 可选：镜头时长（秒）"),
  singleShot: z.boolean().describe("checkCreativeSelection 可选：已确认全程连续拍摄时填 true"),
  storyContext: z.string().trim().max(6000).describe("checkCreativeSelection 可选：镜头合同正文，用于核对专属叙事域"),
  storyDomains: z.array(z.string().trim().min(1).max(24)).max(8).describe("checkCreativeSelection 可选：已确认题材域"),
  storyIntent: z.enum(["dialogue", "action", "effects", "mechanical", "reveal", "environment"]).describe("checkCreativeSelection 可选：镜头意图"),
};

const searchParameters = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("listTags") }),
  z.strictObject({ action: z.literal("listCreativeTags") }),
  z.strictObject({
    action: z.literal("searchCreative"),
    library: searchFields.library.default("all"),
    query: searchFields.query.default(""),
    creativeTags: searchFields.creativeTags.default([]),
    limit: searchFields.limit.default(5),
  }),
  z.strictObject({
    action: z.literal("checkCreativeSelection"),
    selected: searchFields.selected,
    medium: searchFields.medium.default("video"),
    tone: searchFields.tone.default("neutral"),
    durationSeconds: searchFields.durationSeconds.optional(),
    singleShot: searchFields.singleShot.optional(),
    storyContext: searchFields.storyContext.optional(),
    storyDomains: searchFields.storyDomains.optional(),
    storyIntent: searchFields.storyIntent.optional(),
  }),
  z.strictObject({
    action: z.literal("search"),
    tags: searchFields.tags,
    conditions: searchFields.conditions.optional(),
    limit: searchFields.limit.max(5).optional(),
  }),
]);

// 宿主从根对象读取字段类型，服务端按 action 校验必填项、默认值和禁传字段。
const searchToolInput = z.strictObject(searchFields).partial().extend({
  action: z.enum(searchParameters.options.map(option => option.shape.action.value)),
});

export const videoTemplateSearch = {
  name: "searchVideoPromptTemplates",
  label: "分类检索：导演、创作知识与 H3 声音模板",
  description: "只读检索创作参考。listTags/search 查导演拍法。listCreativeTags/searchCreative 查剧情节拍、表情、画风、喜剧、热梗和 H3 声音。按标签检索时每次只用一个标签。search 只填一个维度，searchCreative 先选需要的分类。checkCreativeSelection 核对选中条目的适用条件。",
  promptSnippet: "有具体创作问题时按需检索，每次只填一个标签。拍法用 search，其余创作参考用 searchCreative。用分镜和实际素材核对条目的使用条件。",
  parameters: z.toJSONSchema(searchToolInput, { io: "input", target: "draft-07" }),
  execute(args: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const input = searchParameters.parse(args);
    switch (input.action) {
      case "listTags":
        return { tags: templateTags, formats: templateFormats, anchors: templateAnchors, count: templates.length };
      case "listCreativeTags":
        return listCreativeKnowledgeCategories();
      case "searchCreative":
        return {
          matches: searchCreativeKnowledge({ library: input.library, query: input.query, tags: input.creativeTags, limit: input.limit }),
          notice: "剧情与搞怪用于构思，只取机制与短骨架。热梗有喜剧空间时写入剧本，改写成人物原话后再锁定。片中事件和原话从定稿取。按角色看见、听见什么选择表演。画风和滤镜只描述观感。模板标题与示范句留在库里，勿整段粘进成片。",
        };
      case "checkCreativeSelection":
        return checkCreativeSelection(input);
      case "search":
        return { templates: findVideoPromptTemplates(input.tags, input.conditions, input.limit),
          guidance: "同分候选按编号排列。先用 useWhen 核对本镜的人物关系、空间和动作。适用时从 fragment 取本镜需要的拍法，再用实际人物、物件和动作写正文。verify 仅作自检清单，不写入 H3 正文。已有拍法足够清楚时直接沿用。" };
    }
  },
};

export function createVideoTemplateSearchTool(): ToolDefinition {
  return {
    ...videoTemplateSearch,
    async execute(_id, args, signal) {
      const details = videoTemplateSearch.execute(args, signal);
      return { details, content: [{ type: "text", text: JSON.stringify(details) }] };
    },
  };
}
