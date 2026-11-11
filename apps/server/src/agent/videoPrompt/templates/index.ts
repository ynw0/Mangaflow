import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { actionTemplates } from "@/agent/videoPrompt/templates/actionTemplates";
import { craftTemplates } from "@/agent/videoPrompt/templates/craftTemplates";
import { effectsTemplates } from "@/agent/videoPrompt/templates/effectsTemplates";
import { sceneTemplates } from "@/agent/videoPrompt/templates/sceneTemplates";
import { templateAnchors, templateConditions, templateFormats, templateTags, templateTagSchema } from "@/agent/videoPrompt/templates/schema";
import type { TemplateConditions, VideoPromptTags, VideoPromptTemplate } from "@/agent/videoPrompt/templates/schema";
import { checkCreativeSelection, listCreativeKnowledgeCategories, searchCreativeKnowledge } from "@/agent/creativeKnowledge";

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

const searchParameters = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("listTags") }),
  z.strictObject({ action: z.literal("listCreativeTags") }),
  z.strictObject({
    action: z.literal("searchCreative"),
    library: z.enum(["memes", "absurd", "expressions", "styles", "narrative", "all"]).default("all"),
    query: z.string().trim().max(200).default(""),
    tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  z.strictObject({
    action: z.literal("checkCreativeSelection"),
    selected: z.strictObject({
      narrativeId: z.string().trim().min(1).max(40).optional(),
      expressionId: z.string().trim().min(1).max(40).optional(),
      styleId: z.string().trim().min(1).max(40).optional(),
      filterId: z.string().trim().min(1).max(40).optional(),
      absurdId: z.string().trim().min(1).max(40).optional(),
      memeId: z.string().trim().min(1).max(40).optional(),
    }),
    medium: z.enum(["image","video"]).default("video"),
    tone: z.enum(["neutral","serious","comedy"]).default("neutral"),
    durationSeconds: z.number().positive().max(300).optional(),
  }),
  z.strictObject({
    action: z.literal("search"),
    tags: templateTagSchema,
    conditions: templateConditions.optional(),
    limit: z.number().int().min(1).max(5).optional(),
  }),
]);

export function createVideoTemplateSearchTool(): ToolDefinition {
  return {
    name: "searchVideoPromptTemplates",
    label: "分类检索：导演模板与创作知识库",
    description: "统一分类创作知识库：listTags/search 检索原有导演镜头模板；listCreativeTags/searchCreative 检索2026来源网络热梗、原创喜剧、表情、画风/滤镜和叙事结构；checkCreativeSelection 检查模板组合、适用时长、风格与题材冲突。不生成、不修改画布。",
    promptSnippet: "需要剧情节拍可查 narrative；导演拍法用原 search；人物颜艺查 expressions、画风滤镜查 styles、喜剧查 memes/absurd。先小范围按需检索，挑选 1–3 个互补模板，用 checkCreativeSelection 校验冲突后再独立改写成符合剧本/工作流的提示词，禁止直接拼接模板全文。",
    parameters: z.toJSONSchema(searchParameters, { io: "input", target: "draft-07" }),
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      const input = searchParameters.parse(args);
      const details = input.action === "listTags"
        ? { tags: templateTags, formats: templateFormats, anchors: templateAnchors, count: templates.length }
        : input.action === "listCreativeTags"
          ? listCreativeKnowledgeCategories()
          : input.action === "searchCreative"
            ? {
              matches: searchCreativeKnowledge(input),
              notice: "热梗日期是2026传播记录而非首发或实时榜单。叙事场次模板不可直接塞进单个连续镜头；表情、画风、滤镜是提示词材料，不等于完成节点后期。选用后请检查组合冲突。",
            }
            : input.action === "checkCreativeSelection"
              ? checkCreativeSelection(input)
              : { templates: findVideoPromptTemplates(input.tags, input.conditions, input.limit) };
      return { details, content: [{ type: "text", text: JSON.stringify(details) }] };
    },
  };
}
