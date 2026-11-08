import { parseFrontmatter, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { z } from "zod";
import { addUsage, emptyUsage, runSubAgent, type SubAgentModel } from "@/agent/runtime/subAgent";
import { prepareVideoPrompt, videoPromptParameters } from "@/agent/videoPrompt/input";
import { draftSchema, inspectDraft, reviewSchema } from "@/agent/videoPrompt/format";
import { findVideoPromptTemplates } from "@/agent/videoPrompt/templates";
import type { VideoPromptTags } from "@/agent/videoPrompt/templates/schema";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { findReusableVideoReview, requireSameVideoReview, saveVideoReview } from "@/utils/production/videoReviews";
import { createAgentModel, toSdkThinkingLevel } from "@/agent/runtime/model";
import { resolveAgentProfile, type AgentModelSelection } from "@/agent/runtime/profiles";

const directorReferences = {
  dialogue: ["characterPerformance.md", "soundDesign.md"],
  action: ["actionChoreography.md", "cameraMovement.md"],
  effects: ["visualEffects.md", "lightingAndColor.md"],
  mechanical: ["mechanicalTransformation.md", "actionChoreography.md"],
  reveal: ["scenePlaybooks.md", "compositionAndLens.md"],
  environment: ["environmentDesign.md", "compositionAndLens.md"],
};
const scenesByIntent: Record<keyof typeof directorReferences, NonNullable<VideoPromptTags["scene"]>> = {
  dialogue: ["对话", "质问", "谈判", "告别", "交接"],
  action: ["追逐", "战斗", "格挡", "救援", "撤离", "交接"],
  effects: ["觉醒", "施法", "灾变", "战斗", "格挡"],
  mechanical: ["机械变形", "装置启动"],
  reveal: ["揭示", "调查", "反转", "危险逼近", "反应", "登场"],
  environment: ["场景建立", "转场", "战后余波"],
};
const skillList = z.object({ skills: z.array(z.object({
  name: z.string(), scope: z.enum(["global", "workspace"]), disableModelInvocation: z.boolean().optional(),
})) });
const skillDocument = z.object({ content: z.string().min(1) });

function parseReply<T>(schema: z.ZodType<T>, reply: string) {
  const text = reply.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  return schema.parse(JSON.parse(text));
}

function guideRules(text: string, format: "h3Ref2va" | "h3Frames" | "h3Text", reviewOnly = false) {
  // 只省略官方指南尾部的完整示例；格式、关系词和时间标记规则仍取自原文。
  const exampleHeading = format === "h3Ref2va" ? "\n## 7. Complete Example" : "\n## 5. Cases";
  const rules = text.split(exampleHeading)[0]!;
  if (!reviewOnly) return rules;
  // 审核保留 retention、动作时间轴、说话人和音轨规则，仅省略教学代码范例。
  return rules.replace(/```[^\n]*\n[\s\S]*?```/g, "").replace(/\n{3,}/g, "\n\n");
}

function videoCommonRules(text: string) {
  // 从已有公共 Skill 读取成片相关章节，不维护第二套可能过期的规范。
  const headings = new Set(["事实与边界", "成片正面改写（通用）", "原画 / 成片提示词语言", "跨镜连续性（原则）"]);
  let include = false;
  return text.split("\n").filter(line => {
    const heading = /^#{2,3} (.+)$/.exec(line);
    if (heading) include = headings.has(heading[1]!);
    return include;
  }).join("\n").trim();
}

export function createVideoPromptTool(options: SubAgentModel & {
  cwd: string;
  skillOperator: ToolDefinition;
  canvas?: CanvasContext;
  primaryModel: AgentModelSelection;
}): ToolDefinition {
  const { cwd, skillOperator, canvas, primaryModel, ...model } = options;
  return {
    name: "draftVideoPrompt",
    label: "制作视频提示词",
    description: "根据已确认的镜头合同与真实参考制作 H3 中英文提示词，导演预检、独立审核、最多一次返修。同一镜头合同、参考内容、工作流、技能和模型配置不变时直接复用服务端已审结果，不重复消耗模型 Token；明确要重写时传 regenerate=true。返回审核 ID 与下一步节点操作，不启动生成。已有节点传 node，不传 modelId、duration、ratio、sampling、seed、seedMode；先通过节点 setConfig 配置后再 getPromptContext，获准写回时传 node.write=true。新镜头必须传 duration、ratio。references 必须匹配实际输入。",
    promptSnippet: "制作 H3 镜头时调用 draftVideoPrompt；合同和素材未变可复用已审稿，用户要求重新创作才传 regenerate=true。",
    parameters: { type: "object", ...z.toJSONSchema(videoPromptParameters, { io: "input", target: "draft-07" }) },
    executionMode: "sequential",
    async execute(_id, params, signal, onUpdate, ctx) {
      const startedAt = performance.now();
      const input = videoPromptParameters.parse(params);
      const prepared = await prepareVideoPrompt(cwd, input, canvas, signal);
      const tags = { scene: scenesByIntent[input.intent], ...prepared.templateTags };
      const candidates = findVideoPromptTemplates(tags, {
        ...prepared.templateConditions,
        duration: prepared.setup.duration,
        format: prepared.format,
        imageCount: prepared.setup.references.filter(reference => reference.kind === "image").length,
      });
      const templateMatches = candidates.map(({ id, title, matches }) => ({ id, title, matches }));
      const usage = emptyUsage();
      const modelCalls: { name: string; elapsedMs: number; status: string; providerId?: string; modelId?: string; thinkingLevel?: SubAgentModel["thinkingLevel"]; rulesChars: number; taskChars: number; usage: ReturnType<typeof emptyUsage> }[] = [];
      const skills: { name: string; scope: string; path: string; version?: string }[] = [];
      const attempts: { stage: "director" | "preflight" | "review"; findings: string[] }[] = [];
      const skillCall = async (args: Record<string, string>) =>
        (await skillOperator.execute(crypto.randomUUID(), args, signal, undefined, ctx)).details;
      const available = skillList.parse(await skillCall({ action: "list" })).skills;
      async function read(name: string, path = "SKILL.md") {
        const skill = available.find(item => item.name === name && !item.disableModelInvocation);
        if (!skill) throw new Error(`缺少已启用的制作技能：${name}`);
        const { content } = skillDocument.parse(await skillCall({ action: "read", name, scope: skill.scope, path }));
        const metadata = path === "SKILL.md" ? parseFrontmatter(content).frontmatter.metadata : undefined;
        const version = z.object({ version: z.string() }).safeParse(metadata);
        skills.push({ name, scope: skill.scope, path, ...(version.success ? { version: version.data.version } : {}) });
        return content;
      }
      const directorRules = await Promise.all([
        read("workflow", "references/video-director.md"),
        read("cinematicPromptCraft"), ...directorReferences[input.intent].map(path => read("cinematicPromptCraft", `references/${path}`)),
      ]);
      const [guide, common, reviewRules] = await Promise.all([
        read("h3-prompt-writing", prepared.format === "h3Ref2va" ? "references/ref-en.txt" : "references/base-en.txt"),
        read("workflow", "references/common.md"),
        read("workflow", "references/video-prompt-review.md"),
      ]);
      const formatRules = guideRules(guide, prepared.format);
      const commonRules = videoCommonRules(common);
      const reviewerFormat = guideRules(guide, prepared.format, true);
      const cacheKey = createHash("sha256").update(JSON.stringify({
        input: { ...input, regenerate: undefined, node: input.node ? { canvasId: input.node.canvasId, nodeId: input.node.nodeId } : undefined },
        snapshot: prepared.snapshot, directorRules, guide, common, reviewRules, candidates,
        models: [resolveAgentProfile("videoDirector", primaryModel), resolveAgentProfile("videoReviewer", primaryModel)],
      })).digest("hex");
      const update = (stage: string) => {
        const elapsedMs = Math.round(performance.now() - startedAt);
        const text = `${stage} · ${modelCalls.length} 次模型调用 · 已统计 ${usage.totalTokens.toLocaleString("en-US")} Token · ${Math.round(elapsedMs / 1000)}s`;
        onUpdate?.({ content: [{ type: "text", text }], details: { stage, elapsedMs, usage, modelCalls } });
      };
      const finish = (result: Record<string, unknown>) => {
        const details = { ...result, shotId: input.shotId, workflow: prepared.setup, skills, templateMatches, attempts,
          modelCalls, elapsedMs: Math.round(performance.now() - startedAt) };
        // 节点已写回时，主 Agent 只接收审核状态与定位信息，完整稿仍保存在节点和工具详情中。
        const visible = result.status === "ok" && result.written && input.node
          ? { status: result.status, shotId: input.shotId, reviewId: result.reviewId, written: true,
            node: input.node,
            nextAction: { when: "按当前自动、半自动或目标模式完成相应授权后",
              tool: "nodeTools", args: { canvasId: input.node.canvasId, nodeId: input.node.nodeId, name: "node:generateVideo", args: {} } },
            attempts, modelCalls, elapsedMs: details.elapsedMs }
          : result.status === "ok" && result.generationRequest
            ? Object.fromEntries(Object.entries(details).filter(([key]) => key !== "prompt"))
            : details;
        return { details, content: [{ type: "text" as const, text: JSON.stringify(visible) }], usage };
      };
      async function writePrompt(draft: { prompt: string; promptZh: string }, reviewId: string) {
        let written = false;
        let writeError: string | undefined;
        if (input.node?.write && canvas && prepared.revision) {
          try {
            await canvas.call({
              name: "nodeTools",
              args: { canvasId: input.node.canvasId, nodeId: input.node.nodeId, name: "node:setPrompt",
                args: { ...draft, reviewId, expectedRevision: prepared.revision } },
            }, signal);
            written = true;
          } catch (error) {
            signal?.throwIfAborted();
            writeError = error instanceof Error ? error.message : String(error);
          }
        }
        return { written, writeError };
      }
      if (!input.regenerate) {
        const existing = await findReusableVideoReview(cacheKey, prepared.snapshot);
        if (existing && !inspectDraft(existing, prepared).length) {
          const refreshed = await prepareVideoPrompt(cwd, input, canvas, signal);
          requireSameVideoReview(prepared.snapshot, refreshed.snapshot);
          if (input.node && refreshed.revision !== prepared.revision) throw new Error("视频节点在审稿期间已变化，请重新制作提示词");
          const generationRequest = videoGenerationSchema.parse({ ...refreshed.generationRequest,
            prompt: existing.prompt, reviewId: existing.reviewId });
          const write = await writePrompt(existing, existing.reviewId);
          return finish({ status: "ok", ...existing, generationRequest, ...write, reused: true });
        }
      }
      const taskInput = { shot: prepared.shot, format: prepared.format, workflow: prepared.setup };
      const specialistModels = new Map<string, SubAgentModel>();
      async function specialist<T>(schema: z.ZodType<T>, name: string, task: string, rules: string[]) {
        signal?.throwIfAborted();
        const reviewer = name === "独立提示词审核";
        const selected = resolveAgentProfile(reviewer ? "videoReviewer" : "videoDirector", primaryModel);
        const thinkingLevel = toSdkThinkingLevel(selected.thinkingLevel);
        const cacheKey = JSON.stringify([selected.providerId, selected.modelId, selected.thinkingLevel]);
        let specialistModel = specialistModels.get(cacheKey);
        if (!specialistModel) {
          if (selected.providerId === primaryModel.providerId && selected.modelId === primaryModel.modelId
            && selected.thinkingLevel === primaryModel.thinkingLevel) {
            specialistModel = { ...model, thinkingLevel };
          } else {
            const { runtime } = await createAgentModel(selected.providerId, selected.modelId, selected.thinkingLevel);
            specialistModel = { modelRuntime: runtime, model: runtime.getModel(selected.providerId, selected.modelId), thinkingLevel };
          }
          specialistModels.set(cacheKey, specialistModel);
        }
        update(`${name}中（${selected.modelId} / ${thinkingLevel}）`);
        const callStartedAt = performance.now();
        const output = await runSubAgent({
          ...specialistModel, cwd, name, task, tools: [], signal, responseFormat: "json", specialist: true,
          onProgress: message => update(`${name}：${message}`),
          instructions: [
            "这是只读的 H3 提示词制作任务。以下为宿主已实际加载的技能正文，直接按适用模式执行；当前任务的实际工作流优先于示例。仅根据传入的已确认剧情、素材用途与描述做判断。",
            ...rules,
          ].join("\n\n"),
        });
        addUsage(usage, output.usage);
        // 记录实际返回的用量与单次调用耗时，不按轮次推算 Token 消耗。
        modelCalls.push({ name, elapsedMs: Math.round(performance.now() - callStartedAt), status: output.result.status,
          providerId: selected.providerId, modelId: selected.modelId, thinkingLevel, rulesChars: rules.join("\n\n").length, taskChars: task.length, usage: output.usage });
        update(`${name}${output.result.status === "completed" ? "已完成" : "失败"}`);
        signal?.throwIfAborted();
        if (output.result.status !== "completed") throw new Error(`${name}未完成：${output.result.result}`);
        try { return parseReply(schema, output.result.result); }
        catch { throw new Error(`${name}未返回有效的结构化结果`); }
      }
      let lastDraft: { prompt: string; promptZh: string } | undefined;
      let findings: string[] = [];
      // ACT: 初稿加最多一次定向返修；仍不合格时交回 findings，审核门禁保持关闭。
      for (let round = 0; round < 2; round++) {
        const draft = await specialist(draftSchema, round ? "导演返修" : "导演写作", [
          '输出 {"status":"ok","prompt":"英文生成正文","promptZh":"简中对照"}；缺少关键输入或无法在给定时长交付剧情时，输出 {"status":"blocked","reason":"具体原因"}。',
          "先在内部确定镜头要交付的叙事信息，再设计可见的起点、动作、接触或变化、反馈和末态。按实际模式写 H3 正文，稳定设定与逐段变化分开，英文和中文保持同样的可见事实。",
          "按已确认的剧情和素材取用匹配的拍法。模板片段含占位词、使用条件和验收点，只有条件满足时才采用相关片段，实际正文写真实可观察的事件。返修时保留已经正确的 Subject、参考绑定及无关段落，优先改动指出的时间段，仍返回完整合法正文。",
          JSON.stringify({ ...taskInput, ...(round ? { previousDraft: lastDraft, findings } : { candidates }) }),
        ].join("\n"), [...directorRules, commonRules, formatRules]);
        if (draft.status === "blocked") {
          attempts.push({ stage: "director", findings: [draft.reason] });
          return finish(draft);
        }
        attempts.push({ stage: "director", findings: [] });
        lastDraft = { prompt: draft.prompt, promptZh: draft.promptZh };
        findings = inspectDraft(lastDraft, prepared);
        attempts.push({ stage: "preflight", findings });
        update(findings.length ? "程序预检未通过，准备定向返修" : "程序预检通过");
        if (findings.length) continue;

        const review = await specialist(reviewSchema, "独立提示词审核", [
          '输出 {"status":"ok","findings":[]} 或 {"status":"rejected","findings":["具体时间段或句子的问题及整改目标"]}。只审核当前稿件。',
          "逐项核对剧情硬要求、动作因果和末态、特效来源及反馈、参考用途、画面与声音可执行性以及中英事实一致性。以实际工作流对应的格式为准。只拒绝影响剧情、真实动作、关键身份/参考或可见声画结果的实质缺陷；固定机位、简洁镜头、合理的创作取舍不构成错误。每条整改意见定位到时间段或句子，说明必须达到的可验证结果。",
          JSON.stringify({ ...taskInput, draft: lastDraft }),
        ].join("\n"), [reviewRules, commonRules, reviewerFormat]);
        findings = review.findings;
        attempts.push({ stage: "review", findings });
        update(review.status === "ok" ? "独立审核通过，保存审核记录" : "独立审核退回，准备定向返修");
        if (review.status !== "ok") continue;

        // 无论是否写回节点，都重新核对审稿期间的实际参数、参考内容与工作流。
        const refreshed = await prepareVideoPrompt(cwd, input, canvas, signal);
        requireSameVideoReview(prepared.snapshot, refreshed.snapshot);
        if (input.node && refreshed.revision !== prepared.revision) {
          throw new Error("视频节点在审稿期间已变化，请重新制作提示词");
        }
        const generationRequest = videoGenerationSchema.parse({ ...refreshed.generationRequest, prompt: lastDraft.prompt });
        const reviewId = await saveVideoReview({ ...refreshed.snapshot, prompt: generationRequest.prompt }, {
          shot: prepared.shot, request: generationRequest, promptZh: lastDraft.promptZh, review, skills, templateMatches, attempts,
          modelCalls, usage, reviewElapsedMs: Math.round(performance.now() - startedAt),
        }, cacheKey);
        generationRequest.reviewId = reviewId;
        const write = await writePrompt(lastDraft, reviewId);
        return finish({ status: "ok", ...lastDraft, reviewId, generationRequest, ...write, reused: false });
      }
      return finish({ status: "rejected", findings, written: false });
    },
  };
}
