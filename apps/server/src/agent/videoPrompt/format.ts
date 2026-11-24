import { z } from "zod";
import type { prepareVideoPrompt } from "@/agent/videoPrompt/input";
import { inspectDialogue } from "@/agent/videoPrompt/dialogue";
import { draftCinematicPlanSchema, inspectVideoPlan, type DraftCinematicPlan } from "@/utils/production/videoPlan";
import { getShotRequirements } from "@/utils/production/qcRequirements";

type Prepared = Awaited<ReturnType<typeof prepareVideoPrompt>>;

const draftFields = {
  cinematicPlan: draftCinematicPlanSchema, prompt: z.string().trim().min(1), promptZh: z.string().trim().min(1),
};
const blockedReason = z.string().trim().min(1);
export const draftSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), ...draftFields }),
  z.object({ status: z.literal("blocked"), reason: blockedReason }),
]);
const submissionOptions = { io: "input", target: "draft-07" } as const;
export const draftSubmissionParameters = z.toJSONSchema(z.strictObject({
  status: z.enum(["ok", "blocked"]), ...z.object(draftFields).partial().shape,
  reason: blockedReason.optional().describe("仅在 status 为 blocked 时说明缺少哪些必要信息，或存在哪些冲突"),
}), submissionOptions);

const maxReviewFindings = 12;
export function createReviewSchema(requirementIds: string[]) {
  const requirementId = z.enum(requirementIds);
  const evidence = z.string().trim().min(1).max(500);
  // 通过必须覆盖全部要求且不重复，不能用重复的泛化结论代替缺失项。
  const coverage = z.array(z.object({ requirementId, evidence })).length(requirementIds.length)
    .refine(items => new Set(items.map(item => item.requirementId)).size === requirementIds.length, "审核证据须逐项覆盖且不得重复");
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), framingEvidence: z.string().trim().min(1).max(1500).optional()
      .describe("仅用于说明合同指定的结束构图，或需要在画面中呈现的证据"), coverage, findings: z.tuple([]) }),
    z.object({ status: z.literal("rejected"), needsAdjacentShots: z.literal(true).optional(), findings: z.array(z.object({
      requirementId, location: z.string().trim().min(1).max(300), evidence,
      fixTarget: z.string().trim().min(1).max(500).describe("说明需要恢复的剧情事实、声音与画面的关系，或需要清楚呈现的内容；具体文案和拍摄方法由导演决定"),
    })).min(1).max(maxReviewFindings).describe("完成整份稿件的核对后，汇总本轮确认的实质问题，同一原因合并填写") }),
  ]);
}

export function createReviewSubmission(schema: ReturnType<typeof createReviewSchema>) {
  // 模型工具保留单一对象根；判决分支分别列出必填字段，退稿无需逐项填写通过证据。
  const [approved, rejected] = schema.options;
  const verdict = z.discriminatedUnion("status", [
    approved.strict().extend({ findings: z.array(rejected.shape.findings.element).max(0) }),
    rejected.strict(),
  ]);
  const envelope = z.strictObject({ result: verdict });
  return {
    parameters: z.toJSONSchema(envelope, submissionOptions),
    schema: envelope.transform(({ result }) => schema.parse(result)),
  };
}

export type VideoPromptReview = z.infer<ReturnType<typeof createReviewSchema>>;

// 内置与外部 Agent 使用相同验收范围，避免两套审核门禁漂移。
export function getVideoPromptRequirements(shot: Prepared["shot"]) {
  const speakers = shot.voiceCast ?? [];
  return [
    ...getShotRequirements(shot),
    { id: "framing", text: "镜头数量及切点符合用户合同；cinematicPlan.shots（如有）与 [Shot N] 的时间和顺序一致，镜尾构图与同框要求相容。合同未指定的角度以主体和动作清楚、画面效果符合场戏为准" },
    { id: "actionCausality", text: "动作的开始、结束、接触及其产生的结果，以及声音出现的顺序，都能在给定时长内实现" },
    { id: "dialogueTiming", text: "有对白时，先按定稿核对说话人、原话和接话顺序。每次独立生成视频按实际首次发声顺序从 S1 连续编号，内部切镜不重新编号，未发声的人物不标 S 编号；跨视频保留角色声线而非编号。再检查开口和说完的时间、抢话、口型以及声音在场景中的分布。核对推动剧情、回应前一句或为下一镜提供承接依据的台词是否有合适的发声安排，避免被音乐、音效或别人的声音盖住。时长不足时指出冲突，保留原话并交回分镜调整。无对白时说明依据。" },
    { id: "references", text: "主体身份和素材用途应与实际参考槽位一致，不得猜测素材中没有提供的事实" },
    { id: "bilingualConsistency", text: "先核对中英文是否准确描述同一主体、属性、动作、时间顺序、对白和镜头结束时的事实，再单独通读 promptZh，检查对物件、动作和声线的描述是否通顺、具体。通过证据须摘录一处实际的中文叙述并说明如何保留原意。发现临时创造的简称、生硬的缩略语、过度压缩的句子、词语搭配不当或原意发生变化时，引用原句并退回局部修订。已锁定的台词、专名和原样显示的文字按原文核对。" },
    { id: "creativeIntent", text: `叙事目的：${shot.purpose}。视觉风格：${shot.style}。按播放顺序核对观众何时看懂本镜应交代的信息，以及后续才揭晓的内容是否留在正确时机。指出对应的画面或声音，以及是什么引起了人物的反应。结合分镜判断哪些细节帮助观众辨认人物、理解反应或看出变化。表演与定稿冲突、重复交代妨碍理解，或构图无法呈现关键信息时，指出具体位置和影响。照抄模板动作、无来由的表情，或现场可用普通词说清却自造缩写和术语，同样退回。` },
    ...(speakers.length ? [{ id: "voiceCast", text: `逐项核对声线设定与实际说话人是否一致：${speakers.map(role =>
      `${role.characterName}(${role.speakerId})${role.sourceId ? `（声源模板 ${role.sourceId}）` : ""}`).join("、")}。按定稿逐句核对角色与原话，核对编号是否从 S1 按本片首次发声顺序分配。同一人再次开口沿用原编号。对照剧本核对谁在何处发声、谁听得见。声源模板与发声事实冲突时定位到本轮配置，保留原台词、情绪和已确认语速。` }] : []),
  ];
}

/** Interpret existing story/mustHave/mustNotHave; do not add a second shot-mode field.
 * Negated mentions (e.g. “不要求单镜头”) are not an instruction to prohibit cuts.
 */
export function requiresContinuousTake(shot: { story: string; mustHave: string[]; mustNotHave: string[]; lockedDialogue?: string[] }): boolean {
  const cuts = /^(?:(?:禁止|不得|不要|不许|不允许|无|避免|no)\s*)?(?:(?:任何|所有|全部|全程|any|all|every)\s*)?(?:切镜|镜头切换|切换机位|(?:camera\s+)?cuts?)\s*[。.!！]?$/i;
  if (shot.mustNotHave.some(item => cuts.test(item.trim()))) return true;
  // 作品中的原台词只是剧情内容，已批准的摄影约束仍从合同读取。
  let story = shot.story;
  for (const line of shot.lockedDialogue ?? []) {
    if (line) story = story.replaceAll(line, " ");
  }
  const requirement = [story, ...shot.mustHave].join("；");
  const single = /单一连续镜头|一个连续镜头|单镜头|单一镜头|一镜到底|全程不切镜|禁止切镜|不允许切镜|不得切镜|不许切镜|不切镜|one continuous shot|single continuous take|single shot|one shot|no cuts/gi;
  for (const match of requirement.matchAll(single)) {
    const before = requirement.slice(Math.max(0, (match.index ?? 0) - 22), match.index);
    if (/(?:不再要求|不要求|无需|无须|不必|无需强制|不强制|不限定|不限于|不是|并非|可以不是|允许|取消|放弃|改成|改为)\s*$/i.test(before)) continue;
    return true;
  }
  return false;
}

const refSections = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];
const baseSections = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];

// 首稿只展示本模式的段首，字段顺序与下方预检共用。
export function getPromptOutline(format: Prepared["format"]) {
  const sections = format === "h3Ref2va" ? refSections : baseSections;
  return sections.map(section => section + ":").join("\n");
}

export function inspectDraft(draft: { prompt: string; promptZh: string; cinematicPlan: DraftCinematicPlan }, prepared: Prepared) {
  const { prompt, promptZh } = draft;
  const { format, setup } = prepared;
  const expected = format === "h3Ref2va" ? refSections : baseSections;
  const headings = [...prompt.matchAll(/^[\t ]*(subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)[\t ]*:/gm)];
  const findings: string[] = inspectVideoPlan(draft.cinematicPlan, setup.duration);
  if (headings.length !== expected.length || headings.some((heading, index) => heading[1] !== expected[index])) {
    findings.push(`按实际模式完整输出这些字段：${expected.join("、")}。`);
    return { findings, warnings: [] };
  }
  const prefix = prompt.slice(0, headings[0]!.index).trim();
  // 官方 Ref2VA 允许 [keyframe completion] 和首帧/关键帧关系。
  // 只有真正绑定了 refs.first_frame / refs.last_frame 的工作流才具备专门的帧输入；
  // 普通参考图仍可作为目标帧进行语义引导，但不能承诺逐像素精准锁帧。
  if (format === "h3Ref2va" && (
    /\b(?:very\s+)?(?:first|last|initial|final)\s+(?:video\s+)?frame\s+(?:is|must\s+be|equals|matches)\s+(?:exactly|identical(?:ly)?(?:\s+to)?|pixel[- ]for[- ]pixel)\s*<Picture\s+\d+>/i.test(prompt)
    || /\b(?:pixel[- ]for[- ]pixel|bit[- ]for[- ]bit)\s+(?:identical|match|matching|reproduction)\b/i.test(prompt)
  )) {
    findings.push("普通 Ref2VA 图片可按官方规范用 keyframe completion 描述帧关系，但不保证第一帧/末帧与参考图逐像素一致。删除关于参考图必然逐像素匹配的承诺；如需专用帧输入，请切换实际绑定首尾帧的工作流。");
  }
  if (format !== "h3Frames" && prefix) findings.push("正文须直接从本模式的第一个字段开始。");
  for (const [index, heading] of headings.entries()) {
    const body = prompt.slice(heading.index + heading[0].length, headings[index + 1]?.index).trim();
    if (!body) findings.push(`字段 ${heading[1]} 缺少内容。`);
  }
  const start = headings[format === "h3Ref2va" ? 3 : 0]!;
  const timeline = prompt.slice(start.index + start[0].length, headings.at(-2)!.index);
  // 标题只在正文中识别；对白和可见文字里的引用不构成镜头标记。
  const shotBody = timeline.replace(/<d>[\s\S]*?<\/d>|"[^"\n]*"/gi, match => match.replace(/[^\r\n]/g, " "));
  const shotMarkers = [...shotBody.matchAll(/\[Shot (\d+)\]/g)];
  const opening = shotMarkers[0];
  if (format === "h3Frames") {
    const duration = setup.duration.toFixed(2);
    const first = /Picture 1 \(from Shot 1\)[^;\r\n]*?\b0\.00-second mark/.exec(prefix);
    const last = /Picture 2 \(from Shot ([1-9]\d*)\)[^;\r\n]*?\b(\d+\.\d{2})-second mark/.exec(prefix);
    // 尾帧对齐实际剪辑的末镜，单镜时才和首帧同属 Shot 1。
    const lastShot = shotMarkers.at(-1)?.[1];
    if (/[\r\n]/.test(prefix) || !first || !last || first.index >= last.index || last[1] !== lastShot || last[2] !== duration) {
      findings.push(`首行按 H3 FL2VA 将 Picture 1 对齐开场 0.00 秒，将 Picture 2 对齐正文最后一镜和总时长 ${duration} 秒。`);
    }
  }
  if (!opening || opening[1] !== "1") {
    findings.push(`${start[1]} 的第一个镜头标记须为 [Shot 1]。`);
  } else {
    // The official Ref2VA guide permits sequential [Shot N] cuts. Respect explicit single-take contracts.
    let previousCut = 0;
    for (const [index, marker] of shotMarkers.entries()) {
      const number = Number(marker[1]);
      if (number !== index + 1) {
        findings.push("多个镜头应按 [Shot 1]、[Shot 2] 顺序连续编号，不跳号、不重复。");
        break;
      }
      const following = shotBody.slice((marker.index ?? 0) + marker[0].length,
        shotMarkers[index + 1]?.index);
      if (index === 0) {
        if (/^\s*At\s+\d{2}:\d{2}/i.test(following))
          findings.push("[Shot 1] 应直接描述开场画面，不需要写切入时间。");
      } else {
        const time = /^\s*At\s+(\d{2}):(\d{2})\.(\d{3})(?:\b|,)/i.exec(following);
        if (!time) { findings.push(`[Shot ${number}] 必须以 At MM:SS.mmm 标出切镜时点。`); continue; }
        const at = Number(time[1]) * 60 + Number(time[2]) + Number(time[3]) / 1000;
        if (at <= previousCut || at >= setup.duration)
          findings.push(`[Shot ${number}] 的切镜时间必须递增且处于视频总时长内。`);
        previousCut = at;
      }
    }
    if (shotMarkers.length > 1 && requiresContinuousTake(prepared.shot))
      findings.push("用户明确要求单镜到底，但正文包含多个镜头；需保持一个 [Shot 1]。");
    // Historical reviewed drafts may have no shots plan. New planned shots must agree with
    // the actual [Shot N] markers, cut times and the whole-clip time axis.
    const plannedShots = draft.cinematicPlan.shots;
    if (plannedShots?.length) {
      if (plannedShots.length !== shotMarkers.length) {
        findings.push(`cinematicPlan.shots 规划 ${plannedShots.length} 镜，提示词实际 ${shotMarkers.length} 个 [Shot N]，数量不一致。`);
      }
      for (const [index, planShot] of plannedShots.entries()) {
        const marker = shotMarkers[index];
        if (!marker) break;
        if (Number(marker[1]) !== planShot.id) {
          findings.push(`cinematicPlan.shots[${index}].id 与正文 [Shot ${marker[1]}] 不一致。`);
        }
        if (index === 0) continue;
        const following = shotBody.slice((marker.index ?? 0) + marker[0].length);
        const time = /^\s*At\s+(\d{2}):(\d{2})\.(\d{3})(?:\b|,)/i.exec(following);
        if (!time) continue; // The existing cut-marker preflight already reports its format.
        const at = Number(time[1]) * 60 + Number(time[2]) + Number(time[3]) / 1000;
        if (Math.abs(at - planShot.startSeconds) > 0.001) {
          findings.push(`cinematicPlan.shots[${index}] 从 ${planShot.startSeconds} 秒开始，但正文 [Shot ${marker[1]}] 在 ${at} 秒切入。`);
        }
      }
      if (plannedShots.length > 1 && requiresContinuousTake(prepared.shot) && shotMarkers.length <= 1) {
        findings.push("用户明确要求单镜到底，但 cinematicPlan.shots 规划了多镜头。");
      }
    }
  }
  if (/<d>/.test(timeline.slice(0, opening?.index ?? timeline.length))) findings.push("对白须放进实际发声的 [Shot N]，并位于首个镜头标记之后。");
  const tags = new Set([...prompt.matchAll(/<(?:Picture|Video|Audio) \d+>/g)].map(match => match[0]));
  const approved = new Set(setup.references.map(item => item.label));
  if ([...tags].some(tag => !approved.has(tag)) || (format === "h3Ref2va" && [...approved].some(tag => !tags.has(tag)))) {
    findings.push("参考标签须覆盖实际引用，且编号只能来自准备结果。");
  }
  if (format === "h3Ref2va") {
    const definitions = prompt.slice(headings[0]!.index + headings[0]![0].length, headings[1]!.index);
    const subjects = [...definitions.matchAll(/^[\t ]*<Subject ([1-9]\d*)>/gm)].map(match => match[1]!);
    const used = [...prompt.matchAll(/<Subject (\d+)>/g)].map(match => match[1]!);
    if (subjects.length !== new Set(subjects).size) findings.push("每个 Subject 只能定义一次。");
    if (used.some(id => !subjects.includes(id))) findings.push("存在未在 subject_definitions 中定义的 Subject。");
    const retention = prompt.slice(headings[2]!.index + headings[2]![0].length, headings[3]!.index);
    if (subjects.some(id => !retention.includes(`<Subject ${id}>`))) findings.push("retention_analysis 必须覆盖每个已定义 Subject。");
  }
  if ((prompt.match(/<\/?d\b[^>]*>/gi)?.length ?? 0) !== (timeline.match(/<\/?d\b[^>]*>/gi)?.length ?? 0)) findings.push("对白只能出现在镜头时间轴中。");
  const dialogue = inspectDialogue(timeline, setup.duration, draft.cinematicPlan, prepared.shot.lockedDialogue, prepared.audioEnabled,
    prepared.shot.voiceCast);
  findings.push(...dialogue.findings);
  if (!/\p{Script=Han}/u.test(promptZh)) findings.push("提供与英文事实一致的简体中文对照。");
  // 跳过对白和引号原文，保留正文行号供导演定向返修。
  const narration = prompt.replace(/<d>[\s\S]*?<\/d>|"[^"\n]*"/gi, match => match.replace(/[^\r\n]/g, " "));
  if (/\[[^\[\]\n]*\p{Script=Han}[^\[\]\n]*\]/u.test(narration)) {
    findings.push("英文正文仍有未替换的模板占位词，请写入镜头中的真实对象或动作。");
  }
  for (const match of narration.matchAll(/\b(?:no subtitles|no dialogue)\b/gi)) {
    const line = narration.slice(0, match.index).split("\n").length;
    const correction = match[0].toLowerCase() === "no dialogue"
      ? "可检查是否已写清本镜实际能听见的声音和人物动作。"
      : "可检查字幕要求是否与当前画面和制作合同一致。";
    // 用词提示由审核员结合合同判断，避免词串命中触发整稿自动返修。
    dialogue.warnings.push(`英文正文第 ${line} 行含「${match[0]}」。${correction}`);
  }
  return { findings, warnings: dialogue.warnings };
}
