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
    library: z.enum(["memes", "absurd", "all"]).default("all"),
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
    description: "统一分类检索入口：listTags/search 保留原有视频导演模板功能；listCreativeTags/searchCreative 按标签/关键词检索2026年有日期来源的中国网络热梗与原创抽象搞怪图像/视频构思。只返回匹配项，不会生成或改变画布。",
    promptSnippet: "用户要求抽象、玩梗、无厘头、搞怪或原剧情为喜剧时，优先用本工具 listCreativeTags/searchCreative 按需查少量条目；严肃剧情不强制加梗。2026热梗为有日期的来源样本，不是全网实时热度。",
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
              notice: "仅保留2026年有日期的来源/快照，不能宣称全网实时热门；抽象模板需改写为当前工作流格式并按画布节点执行。",
            }
            : { templates: findVideoPromptTemplates(input.tags, input.conditions, input.limit) };
      return { details, content: [{ type: "text", text: JSON.stringify(details) }] };
    },
  };
}
