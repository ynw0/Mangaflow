import { parseFrontmatter, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { z } from "zod";
import { addUsage, emptyUsage, type SubAgentModel } from "@/agent/runtime/subAgent";
import type { AgentEvent } from "@/agent/runtime/types";
import { prepareVideoPrompt, videoPromptParameters, videoPromptToolSchema } from "@/agent/videoPrompt/input";
import { createReviewSchema, createReviewSubmissionParameters, draftSchema, draftSubmissionParameters, getVideoPromptRequirements, inspectDraft, type VideoPromptReview } from "@/agent/videoPrompt/format";
import { directorSubmissionExample, reviewSubmissionExample, videoPromptInputExample } from "@/agent/videoPrompt/examples";
import { runVideoPromptSpecialist } from "@/agent/videoPrompt/specialist";
import { findVideoPromptTemplates } from "@/agent/videoPrompt/templates";
import type { VideoPromptTags } from "@/agent/videoPrompt/templates/schema";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { findReusableVideoReview, requireSameVideoReview, saveVideoReview } from "@/utils/production/videoReviews";
import { createAgentModel, toSdkThinkingLevel } from "@/agent/runtime/model";
import { resolveAgentProfile, type AgentModelSelection } from "@/agent/runtime/profiles";
import type { CinematicPlan } from "@/utils/production/videoPlan";

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
const reviewerSource = "independentModel";

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
  parentFile: string;
  send(event: AgentEvent): void;
}): ToolDefinition {
  const { cwd, skillOperator, canvas, primaryModel, parentFile, send, ...model } = options;
  return {
    name: "draftVideoPrompt",
    label: "制作视频提示词",
    description: "根据确认的镜头合同和真实参考制作、预检并独立审核 H3 中英文提示词；不启动生成。参数是单一 JSON 对象：mustHave/mustNotHave/references 必须是数组，duration 是数字，不得传 JSON 字符串。已有节点传 node，不传 modelId/duration/ratio/sampling/seed/seedMode；先 getConfig → setConfig → getPromptContext，写回须 node.write=true。新镜头无 node，必须传 duration、ratio。可先调用 searchVideoPromptTemplates 并将选中模板 ID 放入 creativeSelection，避免重复发送模板全文。相同镜头合同和模板不变时优先复用已审稿，重写才传 regenerate=true。",
    promptSnippet: `制作 H3 视频提示词时调用 draftVideoPrompt。已有画布节点传 node 和镜头合同，新镜头必须传 duration 和 ratio。先 searchVideoPromptTemplates 检索所需模板，选中的 ID 通过 creativeSelection 传入，已确认的镜头基调填入 tone。新镜头参数结构示例，内容按实际镜头填写：${JSON.stringify(videoPromptInputExample)}`,
    parameters: { type: "object", ...videoPromptToolSchema },
    executionMode: "sequential",
    async execute(_id, params, signal, onUpdate, ctx) {
      const startedAt = performance.now();
      const input = videoPromptParameters.parse(params);
      const prepared = await prepareVideoPrompt(cwd, input, canvas, signal);
      const { creativeContext } = prepared;
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
      const attempts: { round: number; stage: "director" | "preflight" | "review"; findings: string[]; review?: VideoPromptReview }[] = [];
      const reviewRequirements = getVideoPromptRequirements(prepared.shot);
      const reviewSchema = createReviewSchema(reviewRequirements.map(item => item.id));
      const reviewSubmissionParameters = createReviewSubmissionParameters(reviewSchema);
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
      const framingRules = await read("cinematicPromptCraft", "references/compositionAndLens.md");
      const directorRules = [...new Set([framingRules, ...await Promise.all([
        read("workflow", "references/video-director.md"),
        read("cinematicPromptCraft"), ...directorReferences[input.intent].map(path => read("cinematicPromptCraft", `references/${path}`)),
      ])])];
      const [guide, common, reviewRules] = await Promise.all([
        read("h3-prompt-writing", prepared.format === "h3Ref2va" ? "references/ref-en.txt" : "references/base-en.txt"),
        read("workflow", "references/common.md"),
        read("workflow", "references/video-prompt-review.md"),
      ]);
      const formatRules = guideRules(guide, prepared.format);
      const commonRules = videoCommonRules(common);
      const reviewerFormat = guideRules(guide, prepared.format, true);
      const cacheKey = createHash("sha256").update(JSON.stringify({
        planVersion: 2,
        input: { ...input, regenerate: undefined, node: input.node ? { canvasId: input.node.canvasId, nodeId: input.node.nodeId } : undefined },
        snapshot: prepared.snapshot, directorRules, guide, common, reviewRules, reviewRequirements, candidates, creativeContext,
        models: [resolveAgentProfile("videoDirector", primaryModel), resolveAgentProfile("videoReviewer", primaryModel)],
      })).digest("hex");
      const update = (stage: string) => {
        const elapsedMs = Math.round(performance.now() - startedAt);
        const text = `${stage} · ${modelCalls.length} 次模型调用 · 已统计 ${usage.totalTokens.toLocaleString("en-US")} Token · ${Math.round(elapsedMs / 1000)}s`;
        onUpdate?.({ content: [{ type: "text", text }], details: { stage, elapsedMs, usage, modelCalls } });
      };
      const finish = (result: Record<string, unknown>) => {
        const details = { ...result, reviewer: result.reviewId ? reviewerSource : undefined, shotId: input.shotId, workflow: prepared.setup, skills, templateMatches, creativeSelection: creativeContext, attempts,
          modelCalls, elapsedMs: Math.round(performance.now() - startedAt) };
        // 节点已写回时，主 Agent 只接收审核状态与定位信息，完整稿仍保存在节点和工具详情中。
        const visible = result.status === "ok" && result.written && input.node
          ? { status: result.status, shotId: input.shotId, reviewId: result.reviewId, reviewer: reviewerSource, written: true,
            cinematicPlan: result.cinematicPlan,
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
                args: { prompt: draft.prompt, promptZh: draft.promptZh, reviewId, expectedRevision: prepared.revision } },
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
          const review = reviewSchema.parse(existing.review);
          if (review.status !== "ok") throw new Error("已存提示词缺少通过的逐项审核证据，请重新审核");
          const refreshed = await prepareVideoPrompt(cwd, input, canvas, signal);
          requireSameVideoReview(prepared.snapshot, refreshed.snapshot);
          if (input.node && refreshed.revision !== prepared.revision) throw new Error("视频节点在审稿期间已变化，请重新制作提示词");
          const generationRequest = videoGenerationSchema.parse({ ...refreshed.generationRequest,
            prompt: existing.prompt, reviewId: existing.reviewId });
          const write = await writePrompt(existing, existing.reviewId);
          return finish({ status: "ok", ...existing, review, generationRequest, ...write, reused: true });
        }
      }
      const taskInput = { shot: prepared.shot, format: prepared.format, workflow: prepared.setup,
        ...(creativeContext ? { creativeTemplates: creativeContext } : {}) };
      const specialistModels = new Map<string, SubAgentModel>();
      async function specialist<T>(schema: z.ZodType<T>, parameters: ToolDefinition["parameters"], name: string, task: string, rules: string[]) {
        signal?.throwIfAborted();
        const reviewer = name === "独立提示词审核";
        const selected = resolveAgentProfile(reviewer ? "videoReviewer" : "videoDirector", primaryModel);
        const thinkingLevel = toSdkThinkingLevel(selected.thinkingLevel);
        update(`正在准备${name}（${selected.modelId} / ${thinkingLevel}）`);
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
        const callStartedAt = performance.now();
        const output = await runVideoPromptSpecialist({
          ...specialistModel, cwd, parentFile, send, name, shotId: input.shotId, task, selection: selected, schema, parameters, signal,
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
        if (output.result.status !== "completed" || output.submitted === undefined) {
          throw new Error(`${name}（${selected.modelId}）未完成：${output.result.result}\n本阶段 ${output.usage.totalTokens.toLocaleString("zh-CN")} Token，累计 ${usage.totalTokens.toLocaleString("zh-CN")} Token。`);
        }
        return output.submitted;
      }
      let lastDraft: { prompt: string; promptZh: string; cinematicPlan: CinematicPlan } | undefined;
      let findings: string[] = [];
      // ACT: 初稿加最多一次定向返修；仍不合格时交回 findings，审核门禁保持关闭。
      for (let round = 0; round < 2; round++) {
        const draft = await specialist(draftSchema, draftSubmissionParameters, round ? "导演返修" : "导演写作", [
          '通过 submitResult 提交 status=ok 的完整规划和中英文正文。时间均为镜头内秒数；持续运镜时 stopSeconds=null，无定幅要求时 holdSeconds=0。缺关键输入或无法按时交付剧情时提交 {"status":"blocked","reason":"具体原因"}。',
          "先按原台词给每段对白留足时间，再安排摄影和动作。每处开口写明说话人、开口动作或语气，并用 <d> 包裹原文。逐段交代画内说话者和沉默者，给沉默者写明闭嘴，画外音不让画内人物对口型。中文版同步。",
          "无台词的镜头在英文概要写实际环境声，在时间轴写可见角色闭嘴。不要在概要或时间轴中用 no dialogue 概括静默。",
          `结构示例。调用参数取 submitResult 的对象，成片内容及正文格式以本次镜头为准：${JSON.stringify(directorSubmissionExample)}`,
          "先确定最终画框容纳哪些主体和身体部位，再反推开场机位与运动路径。前景道具与后景人物必须同框时，核对景别、遮挡和人物移动终点；不能一边继续逼近道具一边承诺人物头肩始终入画。规划与中英文正文必须一致。只在首次定义与必要承接处写稳定外观，避免逐段复写。",
          "规划不得新增用户未要求的人物、动作或剧情。没有人物的镜头用 performance 描述物件、环境的可见反馈，不为填字段添加表演者。",
          "先在内部确定镜头要交付的叙事信息，再设计可见的起点、动作、接触或变化、反馈和末态。按实际模式写 H3 正文，稳定设定与逐段变化分开，英文和中文保持同样的可见事实。",
          "按已确认的剧情和素材取用匹配的拍法。creativeTemplates 是外层 Agent 按 ID 选中的创作参考，不是剧情合同；先处理 warnings，只抽取本镜所需的动作/表演/风格，多镜场次不得塞进单个 H3 连续镜头。模板含占位词、使用条件和验收点，满足条件后才写真实可观察的事件。返修以 findings 的要求编号、位置、问题依据和修改目标为边界；仅修改缺陷及必需的关联内容，保留正确的 Subject、参考绑定、对白和无关段落，中英文及 cinematicPlan 同步更新，仍返回完整合法正文。合理的创作选择不为迎合审核而重写。",
          JSON.stringify({ ...taskInput, ...(round ? { previousDraft: lastDraft, findings } : { candidates }) }),
        ].join("\n"), [...directorRules, commonRules, formatRules]);
        if (draft.status === "blocked") {
          attempts.push({ round: round + 1, stage: "director", findings: [draft.reason] });
          return finish(draft);
        }
        attempts.push({ round: round + 1, stage: "director", findings: [] });
        lastDraft = { prompt: draft.prompt, promptZh: draft.promptZh, cinematicPlan: draft.cinematicPlan };
        findings = inspectDraft(lastDraft, prepared);
        attempts.push({ round: round + 1, stage: "preflight", findings });
        update(findings.length ? "程序预检未通过，准备定向返修" : "程序预检通过");
        if (findings.length) continue;

        const review = await specialist(reviewSchema, reviewSubmissionParameters, "独立提示词审核", [
          '通过 submitResult 提交审核结论。退回结构示例：{"status":"rejected","findings":[{"requirementId":"story","location":"Shot 1","evidence":"工友未说话，镜头内未交代其嘴部状态","fixTarget":"在该段写明工友闭嘴等候"}]}。只审核当前稿件。',
          `通过示例。调用参数取 submitResult 的对象，实际提交须覆盖任务的全部编号：${JSON.stringify(reviewSubmissionExample)}`,
          "通过时 coverage 必须恰好覆盖 reviewRequirements 每个编号一次；每条证据用一个短句定位正文事实，禁止只写符合、已检查或复述要求。禁止项说明检查范围与实际安排；没有参考或对白时如实说明不适用及依据，不新增要求。退回只列实质缺陷，不因字数短、固定机位、没有特效或个人审美偏好退回。",
          "对照 cinematicPlan 与真实正文，逐项审核运动终点、停机时间、镜尾同框对象、人物终点及表演节拍是否相容。需要推近特写却又保持远处人物上半身可见，或定幅期间仍继续推进，属于实质缺陷。不能只因六段格式完整就判合格。",
          "逐项核对剧情硬要求、动作因果和末态、特效来源及反馈、参考用途、画面与声音可执行性以及中英事实一致性。以实际工作流对应的格式为准。只拒绝影响剧情、真实动作、关键身份/参考或可见声画结果的实质缺陷；固定机位、简洁镜头、合理的创作取舍不构成错误。每条整改意见定位到时间段或句子，说明必须达到的可验证结果。",
          JSON.stringify({ ...taskInput, reviewRequirements, draft: lastDraft }),
        ].join("\n"), [reviewRules, commonRules, reviewerFormat, framingRules]);
        findings = review.status === "ok" ? [] : review.findings.map(item =>
          `[${item.requirementId}] ${item.location}：${item.evidence}；修改目标：${item.fixTarget}`);
        attempts.push({ round: round + 1, stage: "review", findings, review });
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
          shot: prepared.shot, request: generationRequest, promptZh: lastDraft.promptZh, review, reviewer: reviewerSource, skills, templateMatches, attempts,
          cinematicPlan: lastDraft.cinematicPlan,
          modelCalls, usage, reviewElapsedMs: Math.round(performance.now() - startedAt),
        }, cacheKey);
        generationRequest.reviewId = reviewId;
        const write = await writePrompt(lastDraft, reviewId);
        return finish({ status: "ok", ...lastDraft, review, reviewId, generationRequest, ...write, reused: false });
      }
      return finish({ status: "rejected", findings, written: false });
    },
  };
}
