import { parseFrontmatter, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { z } from "zod";
import { addUsage, emptyUsage, type SubAgentModel } from "@/agent/runtime/subAgent";
import type { AgentEvent } from "@/agent/runtime/types";
import { prepareVideoPrompt, videoPromptParameters, videoPromptToolSchema } from "@/agent/videoPrompt/input";
import { createReviewSchema, createReviewSubmission, draftSchema, draftSubmissionParameters, getPromptOutline, getVideoPromptRequirements, inspectDraft, type VideoPromptReview } from "@/agent/videoPrompt/format";
import { runStructuredSpecialist } from "@/agent/runtime/structuredSpecialist";
import { findVideoPromptTemplates } from "@/agent/videoPrompt/templates";
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
const skillList = z.object({ skills: z.array(z.object({
  name: z.string(), scope: z.enum(["global", "workspace"]), disableModelInvocation: z.boolean().optional(),
})) });
const skillDocument = z.object({ content: z.string().min(1) });
const reviewerSource = "independentModel";

function videoCommonRules(text: string) {
  // 模式、语言和参考绑定由导演规则负责，公共文件只供成片正面写法。
  let include = false;
  return text.split(/\r?\n/).filter(line => {
    const heading = /^#{2,3} (.+)$/.exec(line);
    if (heading) include = heading[1] === "成片正面改写（通用）";
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
    description: "根据确认的镜头合同和真实参考制作、预检并独立审核 H3 中英文提示词；不启动生成。参数是单一 JSON 对象：mustHave/mustNotHave/references 必须是数组，duration 是数字，不得传 JSON 字符串。已有节点传 node，不传 modelId/duration/ratio/sampling/seed/seedMode；先 getConfig → setConfig → getPromptContext，写回须 node.write=true。新镜头无 node，必须传 duration、ratio。可先调用 searchVideoPromptTemplates 并将选中模板 ID 放入 creativeSelection，避免重复发送模板全文。按同一合同继续生成时复用已审稿。用户要求修改目标镜头的提示词、拍法或表演时传 regenerate=true；只复审原稿时传 reReview=true。原合同未变时用 draftId 调用 resumeVideoPrompt；台词或分镜已经修订时，用更新后的完整合同重新提交。",
    promptSnippet: "制作 H3 视频提示词时调用 draftVideoPrompt。shotId 用实际分镜编号，放在顶层。已有节点把当前 canvasId 和 nodeId 放进 node，从镜头合同填写本镜原话和实际参考。新镜头直接传 duration 和 ratio。需要导演拍法时传 templateTags，选用分类创作知识时在 creativeSelection 传 ID。",
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
        const saved = await readPendingDraft(path);
        if (saved.needsAdjacentShots) return requestAdjacentShots(saved.input.shotId, saved.findings);
        return await run({ draftId, saved }, ...args);
      } finally { release(); }
    },
  };
  function requestAdjacentShots(shotId: string, findings: string[]) {
    const details = { status: "blocked", shotId, findings, written: false,
      reason: "请回读已确认的分镜，补齐本镜所回应的原话或事件后重新提交镜头合同",
      nextAction: { tool: initial.name, when: "已在 adjacentShots 补齐相关场次或镜号、原句或触发动作后，使用完整的新合同" } };
    return { details, content: [{ type: "text" as const, text: JSON.stringify(details) }] };
  }
  async function run(resumed: { draftId: string; saved: PendingDraft } | undefined,
    ...[_id, params, signal, onUpdate, ctx]: Parameters<ToolDefinition["execute"]>) {
    const startedAt = performance.now();
    const input = resumed?.saved.input ?? videoPromptParameters.parse(params);
    const draftId = resumed?.draftId ?? crypto.randomUUID();
    const pendingPath = pendingDraftPath(cwd, parentFile, draftId);
    const prepared = await prepareVideoPrompt(cwd, input, canvas, signal);
    const { creativeContext, voiceContext } = prepared;
    // 只按调用方为本镜提供的标签查拍法，镜头用途仍用于加载导演资料。
    const candidates = prepared.templateTags ? findVideoPromptTemplates(prepared.templateTags, {
      ...prepared.templateConditions,
      duration: prepared.setup.duration,
      format: prepared.format,
      imageCount: prepared.setup.references.filter(reference => reference.kind === "image").length,
    }) : [];
    const templateMatches = candidates.map(({ id, title, matches }) => ({ id, title, matches }));
    const usage = emptyUsage();
    const modelCalls: { name: string; elapsedMs: number; status: string; providerId?: string; modelId?: string; thinkingLevel?: SubAgentModel["thinkingLevel"]; rulesChars: number; taskChars: number; usage: ReturnType<typeof emptyUsage> }[] = [];
    const skills: { name: string; scope: string; path: string; version?: string }[] = [];
    const attempts: { round: number; stage: "director" | "preflight" | "review"; findings: string[]; review?: VideoPromptReview }[] = [];
    let preflightWarnings: string[] = [];
    const reviewRequirements = getVideoPromptRequirements(prepared.shot);
    const reviewSchema = createReviewSchema(reviewRequirements.map(item => item.id));
    const reviewSubmission = createReviewSubmission(reviewSchema);
    const skillCall = async (args: Record<string, string>) =>
      (await skillOperator.execute(crypto.randomUUID(), args, signal, undefined, ctx)).details;
    let skillCatalog: Promise<z.infer<typeof skillList>> | undefined;
    async function read(name: string, path = "SKILL.md") {
      const { skills: available } = await (skillCatalog ??= skillCall({ action: "list" }).then(value => skillList.parse(value)));
      const skill = available.find(item => item.name === name && !item.disableModelInvocation);
      if (!skill) throw new Error(`缺少已启用的制作技能：${name}`);
      const { content } = skillDocument.parse(await skillCall({ action: "read", name, scope: skill.scope, path }));
      const metadata = path === "SKILL.md" ? parseFrontmatter(content).frontmatter.metadata : undefined;
      const version = z.object({ version: z.string() }).safeParse(metadata);
      skills.push({ name, scope: skill.scope, path, ...(version.success ? { version: version.data.version } : {}) });
      return content;
    }
    async function loadDirectorRules() {
      const paths = new Set(["compositionAndLens.md", ...directorReferences[input.intent]]);
      const [director, guide, ...craft] = await Promise.all([
        read("workflow", "references/video-director.md"),
        read("h3-prompt-writing", prepared.format === "h3Ref2va" ? "references/ref-en.txt" : "references/base-en.txt"),
        ...Array.from(paths, path => read("cinematicPromptCraft", `references/${path}`)),
      ]);
      return [director, ...craft, guide];
    }
    const { node, references: selectedReferences, creativeSelection, templateTags, templateConditions } = input;
    const draftKey = createHash("sha256").update(JSON.stringify({
      shot: prepared.shot, selectedReferences, creativeSelection, templateTags, templateConditions,
      node: node && { canvasId: node.canvasId, nodeId: node.nodeId },
      snapshot: videoPromptReviewScope(prepared.snapshot),
    })).digest("hex");
    if (resumed && (resumed.saved.draftKey !== draftKey || resumed.saved.revision !== prepared.revision)) {
      throw new Error("稿件或提示词合同已变化，请读取当前节点确认正文、时长、画幅、参考与音轨");
    }
    const update = (stage: string) => {
      const elapsedMs = Math.round(performance.now() - startedAt);
      const text = `${stage} · ${modelCalls.length} 次模型调用 · 已统计 ${usage.totalTokens.toLocaleString("en-US")} Token · ${Math.round(elapsedMs / 1000)}s`;
      onUpdate?.({ content: [{ type: "text", text }], details: { stage, elapsedMs, usage, modelCalls } });
    };
    const finish = (result: Record<string, unknown>) => {
      const advisory = preflightWarnings.length ? { warnings: preflightWarnings } : {};
      const details = { ...result, reviewer: result.reviewId ? reviewerSource : undefined, shotId: input.shotId, workflow: prepared.setup, skills, templateMatches, creativeSelection: creativeContext, attempts,
        ...advisory, modelCalls, elapsedMs: Math.round(performance.now() - startedAt) };
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
      return { details, content: [{ type: "text" as const, text: JSON.stringify({ ...visible, ...advisory }) }], usage };
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
    let lastDraft: { prompt: string; promptZh: string; cinematicPlan: DraftCinematicPlan } | undefined = resumed?.saved.draft;
    if (!resumed && !input.regenerate) {
      const existing = await findReusableVideoReview(draftKey, prepared.snapshot, prepared.nodeDraft, prepared.shot);
      const preflight = existing && inspectDraft(existing, prepared);
      if (input.reReview) {
        if (!existing || !preflight) throw new Error("当前合同没有可复审的已通过稿");
        if (preflight.findings.length) throw new Error("现稿未通过当前预检，请先按实际问题修订");
        lastDraft = { prompt: existing.prompt, promptZh: existing.promptZh, cinematicPlan: existing.cinematicPlan };
      } else if (existing && preflight && !preflight.findings.length) {
        preflightWarnings = preflight.warnings;
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
    // 原声线配置随合同保存，导演和审核员使用同一份已解析的说话人说明。
    const { voiceCast: _voiceTemplates, ...directorShot } = prepared.shot;
    const voiceCast = {
      roles: voiceContext.roles.map(({ speakerId, characterName, voiceIdentity, source, speedMultiplier, identityCues, performanceCues }) =>
        ({ speakerId, characterName, voiceIdentity, source, speedMultiplier, identityCues, performanceCues })),
      warnings: voiceContext.warnings,
    };
    const taskInput = { shot: directorShot, format: prepared.format, workflow: { modelId, duration, ratio, mode, references },
      speechPolicy: getVideoSpeechPolicy(prepared.audioEnabled),
      ...(voiceCast.roles.length ? { voiceCast } : {}),
      ...(creativeContext && (creativeContext.selected.length || creativeContext.warnings.length) ? { creativeTemplates: creativeContext } : {}) };
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
    let directorRules: string[] | undefined;
    let commonRules: string | undefined;
    const currentPreflight = lastDraft && inspectDraft(lastDraft, prepared);
    preflightWarnings = currentPreflight?.warnings ?? [];
    // 续审重跑程序预检，只沿用之前按合同编号记录的内容审核意见。
    const previousReviewFindings = resumed?.saved.findings.filter(finding =>
      reviewRequirements.some(({ id }) => finding.startsWith(`[${id}] `))) ?? [];
    let findings = [...(currentPreflight?.findings ?? []), ...previousReviewFindings];
    const maxRounds = resumed && findings.length ? 1 : 2;
    const nextAction = { tool: resume.name, args: { draftId } };
    // 只自动修一次程序预检。内容退回时保留稿件，按已知问题续审。
    for (let round = 0; round < maxRounds; round++) {
      if (!lastDraft || findings.length) {
        const repair = Boolean(lastDraft);
        if (!directorRules) {
          const [director, common] = await Promise.all([loadDirectorRules(), read("workflow", "references/common.md")]);
          directorRules = director;
          commonRules = videoCommonRules(common);
        }
        const draft = await specialist(draftSchema, draftSubmissionParameters, repair ? "导演返修" : "导演写作", [
          "依据实际镜头合同、已加载的导演规则与 H3 模式写稿，调用 submitResult 提交完整结果。时间使用整段视频内的秒数。",
          ...(repair ? ["用 findings 的位置和证据定位问题。具体修法按当前镜头合同和已加载的写作规则取舍。保留仍有作用的声画事实，使英文正文、中文对照和导演计划一致。"] : []),
          ...(repair ? [] : [`英文正文段名：\n${getPromptOutline(prepared.format)}`]),
          // 拍法候选只在首稿提供，导演先判断条件，再用实际分镜撰写正文。
          JSON.stringify({ ...taskInput,
            ...(repair ? { previousDraft: lastDraft, findings } : {}),
            ...(!repair && candidates.length ? { candidates: candidates.map(({ title, useWhen, fragment, avoid, verify }) =>
              ({ title, useWhen, fragment, avoid, verify })) } : {}),
          }),
        ].join("\n"), [...directorRules, commonRules ?? ""]);
        if (draft.status === "blocked") {
          attempts.push({ round: round + 1, stage: "director", findings: [draft.reason] });
          return finish(draft);
        }
        attempts.push({ round: round + 1, stage: "director", findings: [] });
        lastDraft = { prompt: draft.prompt, promptZh: draft.promptZh, cinematicPlan: draft.cinematicPlan };
        const preflight = inspectDraft(lastDraft, prepared);
        findings = preflight.findings;
        preflightWarnings = preflight.warnings;
        attempts.push({ round: round + 1, stage: "preflight", findings });
        update(findings.length ? "程序预检未通过，准备定向返修" : "程序预检通过");
        if (findings.length) continue;
      }
      // 审核前保存候选稿，只有通过审核才能签发 reviewId。
      await savePendingDraft(pendingPath, { input, draftKey, revision: prepared.revision, draft: lastDraft, findings: [] });
      onUpdate?.({ content: [{ type: "text", text: `待审稿已保存：${draftId}` }], details: { draftId, nextAction } });
      let review: VideoPromptReview;
      try {
        const reviewRules = await read("workflow", "references/video-prompt-review.md");
        review = await specialist(reviewSubmission.schema, reviewSubmission.parameters, "独立提示词审核", [
          "程序预检已完成。按已加载的审核规则核对实际合同和稿件，在 submitResult 的 result 提交判决和具体依据。",
          JSON.stringify({
            // 剧情、必需项、禁止项、风格及连续性已逐条包含在 reviewRequirements。
            shotId: input.shotId, intent: input.intent, tone: input.tone, adjacentShots: input.adjacentShots,
            format: taskInput.format, workflow: taskInput.workflow,
            speechPolicy: taskInput.speechPolicy,
            ...(voiceCast.roles.length ? { voiceCast } : {}),
            reviewRequirements, draft: lastDraft,
          }),
        ].join("\n"), [reviewRules]);
      } catch (error) {
        signal?.throwIfAborted();
        return finish({ status: "reviewFailed", reason: error instanceof Error ? error.message : String(error), draftId, written: false, nextAction });
      }
      findings = review.status === "ok" ? [] : review.findings.map(item =>
        `[${item.requirementId}] ${item.location}：${item.evidence}；修改目标：${item.fixTarget}`);
      attempts.push({ round: round + 1, stage: "review", findings, review });
      // 补证据会改变镜头合同，旧输入不能再用于定向返修。
      if (review.status === "rejected" && review.needsAdjacentShots) {
        await savePendingDraft(pendingPath, { input, draftKey, revision: prepared.revision, draft: lastDraft, findings, needsAdjacentShots: true });
        return finish(requestAdjacentShots(input.shotId, findings).details);
      }
      update(review.status === "ok" ? "独立审核通过，保存审核记录" : "独立审核退回，保留原稿和整改意见");
      if (review.status !== "ok") break;

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
      }, draftKey);
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
