import { parseFrontmatter, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { z } from "zod";
import { addUsage, emptyUsage, type SubAgentModel } from "@/agent/runtime/subAgent";
import type { AgentEvent } from "@/agent/runtime/types";
import { prepareVideoPrompt, videoPromptParameters, videoPromptToolSchema } from "@/agent/videoPrompt/input";
import { createReviewSchema, createReviewSubmission, draftSchema, draftSubmissionParameters, getVideoPromptRequirements, inspectDraft, type VideoPromptReview } from "@/agent/videoPrompt/format";
import { directorSubmissionExample, videoPromptNodeExample } from "@/agent/videoPrompt/examples";
import { runStructuredSpecialist } from "@/agent/runtime/structuredSpecialist";
import { findVideoPromptTemplates } from "@/agent/videoPrompt/templates";
import type { VideoPromptTags } from "@/agent/videoPrompt/templates/schema";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { findReusableVideoReview, requireSameVideoReview, saveVideoReview, videoPromptReviewScope } from "@/utils/production/videoReviews";
import { createAgentModel, toSdkThinkingLevel } from "@/agent/runtime/model";
import { resolveAgentProfile, type AgentModelSelection } from "@/agent/runtime/profiles";
import type { DraftCinematicPlan } from "@/utils/production/videoPlan";
import { lockWorkspaceFiles } from "@/utils/workspace/files";
import { pendingDraftPath, readPendingDraft, removePendingDraft, findPendingDrafts, resumeParameters, savePendingDraft, type PendingDraft } from "./pendingDraft";
import { getVideoSpeechPolicy } from "@/agent/videoPrompt/dialogue";

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

export function createVideoPromptTools(options: SubAgentModel & {
  cwd: string;
  skillOperator: ToolDefinition;
  canvas?: CanvasContext;
  primaryModel: AgentModelSelection;
  parentFile: string;
  send(event: AgentEvent): void;
}): ToolDefinition[] {
  const { cwd, skillOperator, canvas, primaryModel, parentFile, send, ...model } = options;
  const initial: ToolDefinition = {
    name: "draftVideoPrompt",
    label: "制作视频提示词",
    description: "根据确认的镜头合同和真实参考制作、预检并独立审核 H3 中英文提示词；不启动生成。参数是单一 JSON 对象：mustHave/mustNotHave/references 必须是数组，duration 是数字，不得传 JSON 字符串。已有节点传 node，不传 modelId/duration/ratio/sampling/seed/seedMode；先 getConfig → setConfig → getPromptContext，写回须 node.write=true。新镜头无 node，必须传 duration、ratio。可先调用 searchVideoPromptTemplates 并将选中模板 ID 放入 creativeSelection，避免重复发送模板全文。相同镜头合同和模板不变时优先复用已审稿，用户明确要求重写才传 regenerate=true；已返回 draftId 时调用 resumeVideoPrompt，不重发合同。",
    promptSnippet: `制作 H3 视频提示词时调用 draftVideoPrompt。已有画布节点传 node 和镜头合同，新镜头必须传 duration 和 ratio。先 searchVideoPromptTemplates 检索所需模板，选中的 ID 通过 creativeSelection 传入，已确认的镜头基调填入 tone。已有节点示例（取实际合同编号与参考）：${JSON.stringify(videoPromptNodeExample)}。canvasId 仅放 node 内。`,
    parameters: { type: "object", ...videoPromptToolSchema },
    prepareArguments(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("draftVideoPrompt 需要单个镜头合同对象");
      const args = raw as Record<string, unknown>;
      const issues = [];
      if (!args.shotId) issues.push("请从当前已确认的镜头合同填写顶层 shotId，勿用 nodeId 代替");
      if ("canvasId" in args) issues.push("请移除顶层 canvasId，仅在 node.canvasId 中填写目标画布");
      if (issues.length) throw new Error(issues.join("。") + "。已有待审稿可用 resumeVideoPrompt 按原 shotId 查询。");
      return args;
    },
    executionMode: "sequential",
    execute: (...args) => run(undefined, ...args),
  };
  const resume: ToolDefinition = {
    name: "resumeVideoPrompt", label: "继续视频提示词审核",
    description: "按 draftId 继续原镜头。审核提交失败只重审原稿；内容退回则按原合同和整改意见定向返修。编号遗失时只传 shotId 查询本会话待审稿；用户明确放弃时可传 draftId 和 discard=true。",
    parameters: z.toJSONSchema(resumeParameters, { target: "draft-07" }),
    executionMode: "sequential",
    async execute(...args) {
      const query = resumeParameters.parse(args[1]);
      if (!query.draftId) {
        const drafts = await findPendingDrafts(cwd, parentFile, query.shotId!);
        return { content: [{ type: "text", text: JSON.stringify({ drafts }) }], details: { drafts } };
      }
      const draftId = query.draftId;
      const path = pendingDraftPath(cwd, parentFile, draftId);
      const release = lockWorkspaceFiles([path]);
      try {
        if (query.discard) {
          await removePendingDraft(path);
          return { content: [{ type: "text", text: "待审稿已丢弃" }], details: { draftId } };
        }
        return await run({ draftId, saved: await readPendingDraft(path) }, ...args);
      } finally { release(); }
    },
  };
  async function run(resumed: { draftId: string; saved: PendingDraft } | undefined,
    ...[_id, params, signal, onUpdate, ctx]: Parameters<ToolDefinition["execute"]>) {
    const startedAt = performance.now();
    const input = resumed?.saved.input ?? videoPromptParameters.parse(params);
    const draftId = resumed?.draftId ?? crypto.randomUUID();
    const pendingPath = pendingDraftPath(cwd, parentFile, draftId);
    const prepared = await prepareVideoPrompt(cwd, input, canvas, signal);
    const { creativeContext, voiceContext } = prepared;
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
    const reviewSubmission = createReviewSubmission(reviewSchema);
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
    const directorRules = [framingRules, ...await Promise.all([
      read("workflow", "references/video-director.md"),
      read("cinematicPromptCraft"), ...directorReferences[input.intent].filter(path => path !== "compositionAndLens.md")
        .map(path => read("cinematicPromptCraft", `references/${path}`)),
    ])];
    const [guide, common, reviewRules] = await Promise.all([
      read("h3-prompt-writing", prepared.format === "h3Ref2va" ? "references/ref-en.txt" : "references/base-en.txt"),
      read("workflow", "references/common.md"),
      read("workflow", "references/video-prompt-review.md"),
    ]);
    const formatRules = guideRules(guide, prepared.format);
    const commonRules = videoCommonRules(common);
    const reviewerFormat = guideRules(guide, prepared.format, true);
    const sampling = input.sampling && { outputFirstPass: input.sampling.outputFirstPass, loraName: input.sampling.loraName, checkpointName: input.sampling.checkpointName };
    const draftKey = createHash("sha256").update(JSON.stringify({
      planVersion: 4,
      input: { ...input, regenerate: undefined, seed: undefined, seedMode: undefined,
        sampling: sampling && Object.values(sampling).some(value => value !== undefined) ? sampling : undefined,
        node: input.node ? { canvasId: input.node.canvasId, nodeId: input.node.nodeId } : undefined },
      snapshot: videoPromptReviewScope(prepared.snapshot), directorRules, guide, common, reviewRules, reviewRequirements, candidates, creativeContext, voiceContext,
    })).digest("hex");
    const cacheKey = createHash("sha256").update(JSON.stringify([draftKey, resolveAgentProfile("videoDirector", primaryModel), resolveAgentProfile("videoReviewer", primaryModel)])).digest("hex");
    if (resumed && (resumed.saved.draftKey !== draftKey || resumed.saved.revision !== prepared.revision)) {
      throw new Error("原节点、参考、工作流或审核配置已变化，请按当前合同重新制作");
    }
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
          node: input.node,
          nextAction: { when: "按当前自动、半自动或目标模式完成相应授权后",
            tool: "nodeTools", args: { canvasId: input.node.canvasId, nodeId: input.node.nodeId, name: "node:generateVideo", args: {} } },
          totalTokens: usage.totalTokens }
        : result.status === "ok" && result.generationRequest
          ? { status: result.status, shotId: input.shotId, reviewId: result.reviewId, generationRequest: result.generationRequest, promptZh: result.promptZh, cinematicPlan: result.cinematicPlan, written: result.written, writeError: result.writeError, totalTokens: usage.totalTokens }
          : { ...result, shotId: input.shotId, totalTokens: usage.totalTokens };
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
    if (!resumed && !input.regenerate) {
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
    const { modelId, duration, ratio, mode, references } = prepared.setup;
    const taskInput = { shot: prepared.shot, format: prepared.format, workflow: { modelId, duration, ratio, mode, references },
      speechPolicy: getVideoSpeechPolicy(prepared.audioEnabled),
      ...(voiceContext.roles.length ? { voiceCast: voiceContext } : {}),
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
      const output = await runStructuredSpecialist({
        ...specialistModel, cwd, parentFile, send, name, taskLabel: `镜头 ${input.shotId}`, task, selection: selected, schema, parameters, signal,
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
    let lastDraft: { prompt: string; promptZh: string; cinematicPlan: DraftCinematicPlan } | undefined = resumed?.saved.draft;
    let findings: string[] = resumed?.saved.findings.length ? resumed.saved.findings : lastDraft ? inspectDraft(lastDraft, prepared) : [];
    const nextAction = { tool: resume.name, args: { draftId } };
    // ACT: 初稿加最多一次定向返修；仍不合格时交回 findings，审核门禁保持关闭。
    for (let round = 0; round < (resumed?.saved.findings.length ? 1 : 2); round++) {
      if (!lastDraft || findings.length) {
        const repair = Boolean(lastDraft);
        const draft = await specialist(draftSchema, draftSubmissionParameters, repair ? "导演返修" : "导演写作", [
          "按已加载的 H3 与导演 Skill 写完整 cinematicPlan、英文正文和简体中文对照，通过 submitResult 提交 status=ok；无关键输入或合同不可执行则提交 blocked 与具体原因。时间均为整段视频内秒数。",
          "遵守合同选择 [Shot N]：明确一镜到底仅 [Shot 1]；允许剪辑则切点递增、多镜须逐镜填写 cinematicPlan.shots；不添加 shotMode。单一动作/状态变化可只用一个 beats，单镜 shots 可省略；复杂机械、先做后说、精确对白与切镜须充分规划，不能省略必要事件。",
          "按 speechPolicy 和 voiceCast 安排声源、语速、完整对白与末尾至少 0.2 秒收束；人物、参考与原台词须保持合同一致。无对白使用 dialogue: []，描述实际环境声音；无文件不可虚构参考槽位。",
          "画框、机位、动作和结尾须相容；稳定事实只定义一次，不凑词数。创作模板仅是可选参考；返修只针对 findings 修改，并同步完整规划与中英文正文。",
          ...(repair ? [] : [`提交结构示例（事实与时长按当前任务填写）：${JSON.stringify(directorSubmissionExample)}`]),
          JSON.stringify({ ...taskInput, ...(repair ? { previousDraft: lastDraft, findings } : { candidates }) }),
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
      }
      // 审核前保存候选稿，只有通过审核才能签发 reviewId。
      await savePendingDraft(pendingPath, { input, draftKey, revision: prepared.revision, draft: lastDraft, findings: [] });
      onUpdate?.({ content: [{ type: "text", text: `待审稿已保存：${draftId}` }], details: { draftId, nextAction } });
      let review: VideoPromptReview;
      try {
        review = await specialist(reviewSubmission.schema, reviewSubmission.parameters, "独立提示词审核", [
          `按独立审核 Skill 对照当前稿件、cinematicPlan 与原镜头合同进行审核，使用 submitResult。通过时 coverage 对 reviewRequirements 各编号恰好提供一条简短可验证证据，framingEvidence 只证明镜尾独有事实；退回时定位真实缺陷和修复目标。通过示例：{"result":{"status":"ok","coverage":[{"requirementId":"实际编号","evidence":"正文位置及可核验事实"}],"framingEvidence":"镜尾证据","findings":[]}}。退回示例：{"result":{"status":"rejected","findings":[{"requirementId":"实际编号","location":"位置","evidence":"矛盾","fixTarget":"修复目标"}]}}。退回时省略 coverage 和 framingEvidence。`,
          "重点核查镜头切点、机位/构图、动作因果、末态及主体连续性；按 speechPolicy 检查每句说话人、起声与完整收句、口型和音轨，有问题才退回。不要因简短、固定机位、无特效或合理拍法分歧退稿。",
          JSON.stringify({
            // 剧情、必需项、禁止项、风格及连续性已逐条包含在 reviewRequirements。
            shotId: input.shotId, intent: input.intent, tone: input.tone, adjacentShots: input.adjacentShots,
            format: taskInput.format, workflow: taskInput.workflow,
            speechPolicy: taskInput.speechPolicy,
            ...(voiceContext.roles.length ? {voiceCast: voiceContext} : {}),
            reviewRequirements, draft: lastDraft,
          }),
        ].join("\n"), [reviewRules, commonRules, reviewerFormat]);
      } catch (error) {
        signal?.throwIfAborted();
        return finish({ status: "reviewFailed", reason: error instanceof Error ? error.message : String(error), draftId, written: false, nextAction });
      }
      findings = review.status === "ok" ? [] : review.findings.map(item =>
        `[${item.requirementId}] ${item.location}：${item.evidence}；修改目标：${item.fixTarget}`);
      attempts.push({ round: round + 1, stage: "review", findings, review });
      update(review.status === "ok" ? "独立审核通过，保存审核记录" : "独立审核退回，准备定向返修");
      if (review.status !== "ok") {
        await savePendingDraft(pendingPath, { input, draftKey, revision: prepared.revision, draft: lastDraft, findings });
        continue;
      }

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
      await removePendingDraft(pendingPath);
      return finish({ status: "ok", ...lastDraft, review, reviewId, generationRequest, ...write, reused: false });
    }
    if (!lastDraft) throw new Error("缺少导演稿");
    await savePendingDraft(pendingPath, { input, draftKey, revision: prepared.revision, draft: lastDraft, findings });
    return finish({ status: "rejected", findings, draftId, written: false, nextAction });
  }
  return [initial, resume];
}
