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
  status: z.enum(["ok", "blocked"]), ...z.object(draftFields).partial().shape, reason: blockedReason.optional(),
}), submissionOptions);

const maxReviewFindings = 12;
export function createReviewSchema(requirementIds: string[]) {
  const requirementId = z.enum(requirementIds);
  const evidence = z.string().trim().min(1).max(500);
  // 通过必须覆盖全部要求且不重复，不能用重复的泛化结论代替缺失项。
  const coverage = z.array(z.object({ requirementId, evidence })).length(requirementIds.length)
    .refine(items => new Set(items.map(item => item.requirementId)).size === requirementIds.length, "审核证据须逐项覆盖且不得重复");
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), framingEvidence: z.string().trim().min(1).max(1500), coverage, findings: z.tuple([]) }),
    z.object({ status: z.literal("rejected"), findings: z.array(z.object({
      requirementId, location: z.string().trim().min(1).max(300), evidence,
      fixTarget: z.string().trim().min(1).max(500),
    })).min(1).max(maxReviewFindings) }),
  ]);
}

export function createReviewSubmissionParameters(schema: ReturnType<typeof createReviewSchema>) {
  const [approved, rejected] = schema.options;
  return z.toJSONSchema(z.strictObject({
    status: z.enum(["ok", "rejected"]),
    framingEvidence: approved.shape.framingEvidence.optional(),
    coverage: approved.shape.coverage.optional(),
    findings: z.array(rejected.shape.findings.element).max(maxReviewFindings),
  }), submissionOptions);
}

export type VideoPromptReview = z.infer<ReturnType<typeof createReviewSchema>>;

// 内置与外部 Agent 使用相同验收范围，避免两套审核门禁漂移。
export function getVideoPromptRequirements(shot: Prepared["shot"]) {
  return [
    ...getShotRequirements(shot),
    { id: "framing", text: "镜头规划与正文中的构图、运镜终点和镜尾同框要求相容" },
    { id: "actionCausality", text: "动作起止、接触、反馈与声音时序在给定时长内可执行" },
    { id: "dialogueTiming", text: "逐句对照正文与对白计划，核对开口触发、先做动作、停顿、完整台词、听者闭口及 0.2 秒镜尾；无对白时说明依据" },
    { id: "references", text: "主体身份、素材用途与实际参考槽位一致，不臆测未提供的素材事实" },
    { id: "bilingualConsistency", text: "中英文的主体、动作、时序、对白和镜尾事实一致" },
    { id: "creativeIntent", text: `叙事目的：${shot.purpose}；视觉风格：${shot.style}` },
    ...(shot.voiceCast?.length ? [{ id: "voiceCast", text: `声音身份与说话人逐项匹配：${shot.voiceCast.map(role => `${role.characterName}(${role.speakerId})`).join("、")}；保留台词、情绪及对应语速，音轨必须开启` }] : []),
  ];
}

const refSections = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];
const baseSections = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];

export function inspectDraft(draft: { prompt: string; promptZh: string; cinematicPlan: DraftCinematicPlan }, prepared: Prepared) {
  const { prompt, promptZh } = draft;
  const { format, setup } = prepared;
  const expected = format === "h3Ref2va" ? refSections : baseSections;
  const headings = [...prompt.matchAll(/^[\t ]*(subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)[\t ]*:/gm)];
  const findings: string[] = inspectVideoPlan(draft.cinematicPlan, setup.duration);
  if (headings.length !== expected.length || headings.some((heading, index) => heading[1] !== expected[index])) {
    findings.push(`按实际模式完整输出这些字段：${expected.join("、")}。`);
    return findings;
  }
  const prefix = prompt.slice(0, headings[0]!.index).trim();
  // 官方 Ref2VA 允许 [keyframe completion] 和首帧/关键帧关系。
  // 只有真正绑定了 refs.first_frame / refs.last_frame 的工作流才具备专门的帧输入；
  // 普通参考图仍可作为目标帧进行语义引导，但不能承诺逐像素精准锁帧。
  if (format === "h3Ref2va" && (
    /\b(?:very\s+)?(?:first|last|initial|final)\s+(?:video\s+)?frame\s+(?:is|must\s+be|equals|matches)\s+(?:exactly|identical(?:ly)?(?:\s+to)?|pixel[- ]for[- ]pixel)\s*<Picture\s+\d+>/i.test(prompt)
    || /\b(?:pixel[- ]for[- ]pixel|bit[- ]for[- ]bit)\s+(?:identical|match|matching|reproduction)\b/i.test(prompt)
  )) {
    findings.push("普通 Ref2VA 图片可按官方规范用 keyframe completion 描述帧关系，但不保证第一帧/末帧与参考图逐像素一致。删除硬匹配承诺；如需专用帧输入，请切换实际绑定首尾帧的工作流。");
  }
  if (format === "h3Frames") {
    const duration = setup.duration.toFixed(2);
    if (prefix.split("\n").length !== 1 || !/Picture 1 \(from Shot 1\).*0\.00-second mark/.test(prefix)
      || !prefix.includes("Picture 2 (from Shot 1)") || !prefix.includes(`${duration}-second mark`)) {
      findings.push("首行须按 H3 FL2VA 说明对齐首帧、尾帧和实际时长；首尾帧均来自 Shot 1。");
    }
  } else if (prefix) findings.push("正文须直接从本模式的第一个字段开始。");
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
  if (shotMarkers.length !== 1 || opening?.[1] !== "1") {
    findings.push("连续摄影镜头须用一个 [Shot 1]；镜内动作与对白用自然语言描述。");
  } else if (/^\s*At\s+\d{2}:\d{2}/i.test(shotBody.slice(opening.index + opening[0].length))) {
    findings.push("[Shot 1] 直接描述开场画面，近似镜内时点写在动作中。");
  }
  if (/<d>/.test(timeline.slice(0, opening?.index ?? timeline.length))) findings.push("对白须位于 [Shot 1] 正文中。");
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
  findings.push(...inspectDialogue(timeline, setup.duration, draft.cinematicPlan));
  if (!/\p{Script=Han}/u.test(promptZh)) findings.push("提供与英文事实一致的简体中文对照。");
  // 跳过对白和引号原文，保留正文行号供导演定向返修。
  const narration = prompt.replace(/<d>[\s\S]*?<\/d>|"[^"\n]*"/gi, match => match.replace(/[^\r\n]/g, " "));
  if (/\[[^\[\]\n]*\p{Script=Han}[^\[\]\n]*\]/u.test(narration)) {
    findings.push("英文正文仍有未替换的模板占位词，请写入镜头中的真实对象或动作。");
  }
  for (const match of narration.matchAll(/\b(?:no cuts|no subtitles|no dialogue|the camera cuts to|the shot cuts to)\b/gi)) {
    const line = narration.slice(0, match.index).split("\n").length;
    const correction = match[0].toLowerCase() === "no dialogue"
      ? "无台词镜头的概要写实际环境声，时间轴写明可见角色闭嘴。"
      : "请用正向可见事实描述一个连续摄影镜头。";
    findings.push("英文正文第 " + line + " 行含“" + match[0] + "”。" + correction);
  }
  return findings;
}
