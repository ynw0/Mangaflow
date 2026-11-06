import { z } from "zod";
import type { QcCheck, QcRequirement, QcVideoResult } from "@toonflow/tools-scaffold/runtime";

export type QcMode = "video" | "audio" | "merged";

const qcPayload = z.object({
  checks: z.array(z.object({
    requirementId: z.string().trim().min(1).optional(),
    domain: z.enum(["video", "audio", "general"]),
    result: z.enum(["pass", "fail", "unverified"]),
    evidence: z.string().trim().min(1),
    time: z.string().trim().min(1).optional(),
  })).min(1),
});

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return;
  }
}

export function summarizeQc(checks: QcCheck[]): Pick<QcVideoResult, "status" | "checks" | "findings"> {
  // 文本是证据，汇总只读取结构化判定。保留合格证据供复查。
  const findings = checks.filter(check => check.result !== "pass").map(check => ({
    domain: check.domain,
    text: [check.requirementId ? `[${check.requirementId}] ${check.requirement ?? ""}` : "", check.time, check.evidence].filter(Boolean).join(" "),
  }));
  const status = checks.some(check => check.result === "fail") ? "rejected"
    : checks.length && findings.length === 0 ? "ok" : "unverified";
  return { status, checks, findings };
}

export function parseQcPayload(text: string, mode: QcMode, hasAudio = true, requirements: QcRequirement[] = [], timelineEvidence = true) {
  const parsed = qcPayload.safeParse(extractJsonObject(text));
  const required = mode === "merged" ? ["video", "audio"] as const : [mode];
  const checks: QcCheck[] = parsed.success
    ? parsed.data.checks.filter(check => check.domain === "general" || (required.includes(check.domain) && (check.domain !== "audio" || hasAudio)))
    : [{ domain: "general", result: "unverified", evidence: "模型未返回有效的逐项质检结果。" }];
  for (const domain of required) {
    if (checks.some(check => check.domain === domain)) continue;
    const evidence = domain === "video" ? "模型未给出画面判定。"
      : hasAudio ? "模型未给出音轨判定。" : "成片没有可核验的音轨。";
    checks.push({ domain, result: "unverified", evidence });
  }
  const expected = new Map(requirements.map(item => [item.id, item]));
  for (const check of checks) {
    if (!check.requirementId) continue;
    const requirement = expected.get(check.requirementId);
    if (!requirement) {
      if (check.result === "pass") check.result = "unverified";
      check.evidence = `未知验收编号，不能证明合同覆盖。${check.evidence}`;
      continue;
    }
    check.requirement = requirement.text;
    const duplicates = checks.filter(item => item.requirementId === requirement.id).length > 1;
    // 抽取三帧不能证明完整剧情或镜尾动作；缺时间证据、重复项同样不能算通过。
    if (check.result === "pass" && (duplicates || !timelineEvidence || !check.time)) {
      check.result = "unverified";
      check.evidence = `${duplicates ? "验收编号重复" : !timelineEvidence ? "仅有稀疏抽帧，无法确认完整动作和镜尾状态" : "缺少可定位的时间证据"}。${check.evidence}`;
    }
  }
  for (const requirement of requirements) {
    if (checks.some(check => check.requirementId === requirement.id)) continue;
    checks.push({ domain: "video", requirementId: requirement.id, requirement: requirement.text,
      result: "unverified", evidence: "模型未单独验收此项已审要求。" });
  }
  return summarizeQc(checks);
}
