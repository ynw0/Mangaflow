import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { actionTemplates } from "@/agent/videoPrompt/templates/actionTemplates";
import { craftTemplates } from "@/agent/videoPrompt/templates/craftTemplates";
import { effectsTemplates } from "@/agent/videoPrompt/templates/effectsTemplates";
import { sceneTemplates } from "@/agent/videoPrompt/templates/sceneTemplates";
import { templateAnchors, templateConditions, templateFormats, templateTags, templateTagSchema } from "@/agent/videoPrompt/templates/schema";
import type { TemplateConditions, VideoPromptTags, VideoPromptTemplate } from "@/agent/videoPrompt/templates/schema";

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
    label: "查找视频提示词模板",
    description: "按多个结构化标签查询内置导演模板。listTags 返回可选标签；search 结合剧情用途、情绪、表演、动作、特效、摄影、构图、光影、声音和环境，按已知执行条件返回候选与使用说明。",
    parameters: z.toJSONSchema(searchParameters, { io: "input", target: "draft-07" }),
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      const input = searchParameters.parse(args);
      const details = input.action === "listTags"
        ? { tags: templateTags, formats: templateFormats, anchors: templateAnchors, count: templates.length }
        : { templates: findVideoPromptTemplates(input.tags, input.conditions, input.limit) };
      return { details, content: [{ type: "text", text: JSON.stringify(details) }] };
    },
  };
}
