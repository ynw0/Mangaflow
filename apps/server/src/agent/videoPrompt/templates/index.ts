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
  tags: templateTagSchema.describe("search 必填：按维度提供标签对象"),
  conditions: templateConditions.describe("search 可选：镜头时长与画面条件"),
  library: z.enum(["memes", "absurd", "expressions", "styles", "narrative", "all"]).describe("searchCreative 可选：创作知识库类别"),
  query: z.string().trim().max(200).describe("searchCreative 可选：检索关键词"),
  creativeTags: z.array(z.string().trim().min(1).max(24)).max(8).describe("searchCreative 可选：标签字符串数组"),
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
  label: "分类检索：导演模板与创作知识库",
  description: "统一分类创作知识库：listTags/search 检索原有导演镜头模板；listCreativeTags/searchCreative 检索2026来源网络热梗、原创喜剧、表情、画风/滤镜和叙事结构；checkCreativeSelection 检查模板组合、适用时长、风格与题材冲突。不生成、不修改画布。",
  promptSnippet: "需要剧情节拍可查 narrative；导演拍法用原 search；人物颜艺查 expressions、画风滤镜查 styles、喜剧查 memes/absurd。先小范围按需检索，挑选 1–3 个互补模板，用 checkCreativeSelection 校验冲突后再独立改写成符合剧本/工作流的提示词，禁止直接拼接模板全文。",
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
          notice: "热梗日期是2026传播记录而非首发或实时榜单。叙事场次模板不可直接塞进单个连续镜头；表情、画风、滤镜是提示词材料，不等于完成节点后期。选用后请检查组合冲突。",
        };
      case "checkCreativeSelection":
        return checkCreativeSelection(input);
      case "search":
        return { templates: findVideoPromptTemplates(input.tags, input.conditions, input.limit) };
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
