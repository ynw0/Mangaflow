import { z } from "zod";
import type { prepareVideoPrompt } from "@/agent/videoPrompt/input";

type Prepared = Awaited<ReturnType<typeof prepareVideoPrompt>>;

export const draftSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), prompt: z.string().trim().min(1), promptZh: z.string().trim().min(1) }),
  z.object({ status: z.literal("blocked"), reason: z.string().trim().min(1) }),
]);
export const reviewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), findings: z.tuple([]) }),
  z.object({ status: z.literal("rejected"), findings: z.array(z.string().trim().min(1)).min(1).max(12) }),
]);

const refSections = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];
const baseSections = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];

export function inspectDraft(draft: { prompt: string; promptZh: string }, prepared: Prepared) {
  const { prompt, promptZh } = draft;
  const { format, setup } = prepared;
  const expected = format === "h3Ref2va" ? refSections : baseSections;
  const headings = [...prompt.matchAll(/^[\t ]*(subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)[\t ]*:/gm)];
  const findings: string[] = [];
  if (headings.length !== expected.length || headings.some((heading, index) => heading[1] !== expected[index])) {
    findings.push(`按实际模式完整输出这些字段：${expected.join("、")}。`);
    return findings;
  }
  const prefix = prompt.slice(0, headings[0]!.index).trim();
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
    if (!index) {
      if (/^\s*At\b/.test(segment[2] ?? "")) findings.push("首段直接从起始状态写起。");
      continue;
    }
    const seconds = time ? Number(time[1]) * 60 + Number(time[2]) + Number(time[3]) / 1000 : 0;
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
  if (!/\p{Script=Han}/u.test(promptZh)) findings.push("提供与英文事实一致的简体中文对照。");
  const narration = prompt.replace(/<d>[\s\S]*?<\/d>/gi, "").replace(/"[^"\n]*"/g, "");
  if (/\b(?:no cuts|no subtitles|no dialogue|the camera cuts to|the shot cuts to)\b/i.test(narration)) {
    findings.push("用正向可见事实描述一个连续摄影镜头。");
  }
  return findings;
}
