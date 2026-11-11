import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { actionTemplates } from "@/agent/videoPrompt/templates/actionTemplates";
import { craftTemplates } from "@/agent/videoPrompt/templates/craftTemplates";
import { effectsTemplates } from "@/agent/videoPrompt/templates/effectsTemplates";
import { sceneTemplates } from "@/agent/videoPrompt/templates/sceneTemplates";
import { templateAnchors, templateConditions, templateFormats, templateTags, templateTagSchema } from "@/agent/videoPrompt/templates/schema";
import type { TemplateConditions, VideoPromptTags, VideoPromptTemplate } from "@/agent/videoPrompt/templates/schema";
import { listCreativeKnowledgeCategories, searchCreativeKnowledge } from "@/agent/creativeKnowledge";

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
    library: z.enum(["memes", "absurd", "expressions", "styles", "all"]).default("all"),
    query: z.string().trim().max(200).default(""),
    tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
    limit: z.number().int().min(1).max(10).default(5),
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
    description: "统一分类检索：listTags/search 保留导演模板；listCreativeTags/searchCreative 检索2026有来源网络热梗、原创搞怪、人物表情（常规/搞怪/极夸张/抽象）、画风和滤镜。只读，按需返回少量结果，不执行生成或后期处理。",
    promptSnippet: "写表情/颜艺、画风或滤镜时可用 searchCreative 查询 expressions/styles；喜剧/玩梗时查 memes/absurd。优先复用已定角色与镜头约束，少量检索后改写，不在严肃剧情自动加梗；知识库不会自动出图或执行滤镜。",
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
              notice: "热梗为2026有日期记录而非实时全网排名；表情/画风/滤镜只是可组合提示词，不能改变已有角色身份或代替真实滤镜处理；最终仍须按当前工作流审核并通过画布节点执行。",
            }
            : { templates: findVideoPromptTemplates(input.tags, input.conditions, input.limit) };
      return { details, content: [{ type: "text", text: JSON.stringify(details) }] };
    },
  };
}
