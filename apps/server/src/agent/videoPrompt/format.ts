import { z } from "zod";
import type { prepareVideoPrompt } from "@/agent/videoPrompt/input";
import { inspectDialogue } from "@/agent/videoPrompt/dialogue";
import { cinematicPlanSchema, inspectVideoPlan, type CinematicPlan } from "@/utils/production/videoPlan";
import { getShotRequirements } from "@/utils/production/qcRequirements";

type Prepared = Awaited<ReturnType<typeof prepareVideoPrompt>>;

export const draftSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), cinematicPlan: cinematicPlanSchema, prompt: z.string().trim().min(1), promptZh: z.string().trim().min(1) }),
  z.object({ status: z.literal("blocked"), reason: z.string().trim().min(1) }),
]);
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
    })).min(1).max(12) }),
  ]);
}

export type VideoPromptReview = z.infer<ReturnType<typeof createReviewSchema>>;

// 内置与外部 Agent 使用相同验收范围，避免两套审核门禁漂移。
export function getVideoPromptRequirements(shot: Prepared["shot"]) {
  return [
    ...getShotRequirements(shot),
    { id: "framing", text: "镜头规划与正文中的构图、运镜终点和镜尾同框要求相容" },
    { id: "actionCausality", text: "动作起止、接触、反馈与声音时序在给定时长内可执行" },
    { id: "references", text: "主体身份、素材用途与实际参考槽位一致，不臆测未提供的素材事实" },
    { id: "bilingualConsistency", text: "中英文的主体、动作、时序、对白和镜尾事实一致" },
    { id: "creativeIntent", text: `叙事目的：${shot.purpose}；视觉风格：${shot.style}` },
  ];
}

const refSections = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];
const baseSections = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];

export function inspectDraft(draft: { prompt: string; promptZh: string; cinematicPlan: CinematicPlan }, prepared: Prepared) {
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
  // 单图参考/多图 Ref2VA 并不具备 first_frame、last_frame 硬绑定；不可用文字冒充关键帧。
  if (format !== "h3Frames" && (
    /\[keyframe completion\]/i.test(prompt)
    || /\b(?:exact|actual|true)\s+(?:first|starting)\s+(?:video\s+)?frame\b/i.test(prompt)
    || /\bfirst (?:video )?frame is exactly\b/i.test(prompt)
  )) {
    findings.push("当前工作流是参考图模式，没有专用首尾帧绑定。不得声明 keyframe completion 或严格第一帧；请换用真实 h3Frames 工作流，或改写为普通参考图语义。");
  }
  if (format === "h3Frames") {
    const duration = setup.duration.toFixed(2);
    if (prefix.split("\n").length !== 1 || !/Picture 1.*0\.00-second mark/.test(prefix)
      || !prefix.includes("Picture 2") || !prefix.includes(`${duration}-second mark`)) {
      findings.push("首行须按 H3 FL2VA 说明对齐首帧、尾帧和实际时长。");
    }
  } else if (prefix) findings.push("正文须直接从本模式的第一个字段开始。");
  for (const [index, heading] of headings.entries()) {
    const body = prompt.slice(heading.index + heading[0].length, headings[index + 1]?.index).trim();
    if (!body) findings.push(`字段 ${heading[1]} 缺少内容。`);
  }
  const start = headings[format === "h3Ref2va" ? 3 : 0]!;
  const timeline = prompt.slice(start.index + start[0].length, headings.at(-2)!.index);
  const segments = [...timeline.matchAll(/(?:^|\n)[\t ]*\[Shot (\d+)\]([^\n]*)/g)];
  let previous = 0;
  const windows: { index: number; number: string; start: number }[] = [];
  if (!segments.length) findings.push("缺少 [Shot 1] 时间段。");
  if (format === "h3Frames" && !prefix.includes(`Picture 2 (from Shot ${segments.length})`)) {
    findings.push("尾帧对齐说明须指向实际最后一个时间段。");
  }
  for (const [index, segment] of segments.entries()) {
    if (Number(segment[1]) !== index + 1) {
      findings.push("时间段编号须从 Shot 1 连续递增。");
      break;
    }
    const time = /^\s*At (\d{2}):([0-5]\d)\.(\d{3})(?=\D|$)/.exec(segment[2] ?? "");
    const seconds = index && time ? Number(time[1]) * 60 + Number(time[2]) + Number(time[3]) / 1000 : 0;
    windows.push({ index: segment.index, number: segment[1]!, start: seconds });
    if (!index) {
      if (/^\s*At\b/.test(segment[2] ?? "")) findings.push("首段直接从起始状态写起。");
      continue;
    }
    if (seconds <= previous || seconds >= setup.duration) {
      findings.push("后续时间段须使用 At MM:SS.mmm，时点严格递增且早于镜尾。");
      break;
    }
    previous = seconds;
  }
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
  if (/<d>/.test(timeline.slice(0, windows[0]?.index))) findings.push("对白必须位于编号时间段内。");
  findings.push(...inspectDialogue(timeline, setup.duration, windows));
  if (!/\p{Script=Han}/u.test(promptZh)) findings.push("提供与英文事实一致的简体中文对照。");
  const narration = prompt.replace(/<d>[\s\S]*?<\/d>/gi, "").replace(/"[^"\n]*"/g, "");
  if (/\[[^\[\]\n]*\p{Script=Han}[^\[\]\n]*\]/u.test(narration)) {
    findings.push("英文正文仍有未替换的模板占位词，请写入镜头中的真实对象或动作。");
  }
  if (/\b(?:no cuts|no subtitles|no dialogue|the camera cuts to|the shot cuts to)\b/i.test(narration)) {
    findings.push("用正向可见事实描述一个连续摄影镜头。");
  }
  return findings;
}
