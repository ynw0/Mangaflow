import { z } from "zod";
import type { QcCheck, QcRequirement, QcVideoResult } from "@toonflow/tools-scaffold/runtime";

export type QcMode = "video" | "audio" | "merged";

export function requirementsForQc(requirements: QcRequirement[], mode: QcMode) {
  return requirements.filter(requirement => mode === "merged"
    || (mode === "audio" ? requirement.domain === "audio" : requirement.domain !== "audio"));
}

const qcPayload = z.object({
  checks: z.array(z.object({
    requirementId: z.string().trim().min(1).optional(),
    domain: z.enum(["video", "audio", "general"]),
    result: z.enum(["pass", "fail", "unverified"]),
    evidence: z.string().trim().min(1),
    time: z.string().trim().min(1).optional(),
    problem: z.string().trim().min(1).max(600).optional(),
    fixHint: z.string().trim().min(1).max(600).optional(),
  })).min(1),
});

function extractJsonObject(text: string): { value?: unknown; error?: string } {
  if (!text.trim()) return { error: "质检模型返回空正文。" };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { error: "未找到完整 JSON 对象；可能未遵守格式或输出被截断。" };
  try {
    return { value: JSON.parse(text.slice(start, end + 1)) };
  } catch {
    return { error: "JSON 语法无效或正文不完整；可能输出截断，需查看原始回复确认。" };
  }
}

// 质检模型可能重复输出同一编号；先合并再计数，不能把互相矛盾的结论当成通过或失败。
function compactQcChecks(checks: QcCheck[]): QcCheck[] {
  const groups = new Map<string, QcCheck[]>();
  for (const check of checks) {
    const key = check.requirementId
      ? `requirement:${check.domain}:${check.requirementId}`
      : `diagnostic:${check.domain}\u0000${check.result}\u0000${check.time ?? ""}\u0000${check.evidence.replace(/\s+/g, " ").trim()}`;
    const existing = groups.get(key);
    if (existing) existing.push(check);
    else groups.set(key, [check]);
  }
  return [...groups.values()].map((group): QcCheck => {
    const first = group[0]!;
    if (!first.requirementId || group.length === 1) return first;
    const passed = group.some(item => item.result === "pass");
    const failed = group.some(item => item.result === "fail");
    if (passed && failed) {
      const positive = group.find(item => item.result === "pass")!;
      const negative = group.find(item => item.result === "fail")!;
      return { ...first, result: "unverified",
        evidence: `同一验收编号同时出现通过和失败，需查看原片复核。通过依据：${positive.evidence.slice(0, 180)}；失败依据：${negative.evidence.slice(0, 180)}` };
    }
    if (failed) {
      const failure = group.find(item => item.result === "fail")!;
      return { ...failure, evidence: `同一编号的 ${group.length} 条结果已合并。 ${failure.evidence}` };
    }
    return { ...first, result: "unverified",
      evidence: `验收编号重复 ${group.length} 次，不能据此判定通过；需对照时间证据复核。 ${first.evidence}` };
  });
}

export function summarizeQc(checks: QcCheck[]): Pick<QcVideoResult, "status" | "checks" | "findings" | "issues"> {
  // 文本是证据，先归并重复/冲突项，再读取结构化判定。
  checks = compactQcChecks(checks);
  const findings = checks.filter(check => check.result !== "pass").map(check => ({
    domain: check.domain,
    text: [check.requirementId ? `[${check.requirementId}] ${check.requirement ?? ""}` : "", check.time, check.evidence].filter(Boolean).join(" "),
  }));
  const issues = checks.flatMap((check, index) => check.result === "pass" ? [] : [{
    id: check.requirementId ? `${check.domain}:${check.requirementId}` : `diagnostic:${check.domain}:${index}`,
    ...(check.requirementId ? { requirementId: check.requirementId } : {}),
    domain: check.domain,
    kind: check.result === "fail" ? "defect" as const : "needsEvidence" as const,
    ...(check.requirement ? { expected: check.requirement } : {}),
    observed: check.evidence,
    problem: check.problem ?? check.evidence,
    ...(check.time ? { time: check.time } : {}),
    ...(check.fixHint ? { fixHint: check.fixHint } : {}),
  }]);
  const status = checks.some(check => check.result === "fail") ? "rejected"
    : checks.length && findings.length === 0 ? "ok" : "unverified";
  return { status, checks, findings, issues };
}

/** 统一验证整改计划引用的 QC 问题编号，防止漏项或引用旧版问题。 */
export function validateRectificationCoverage(checks: QcCheck[], actions: { issueIds: string[] }[]) {
  const issues = summarizeQc(checks).issues ?? [];
  const known = new Set(issues.map(issue => issue.id));
  if (!issues.length) throw new Error("当前 QC 没有需要整改或补证的问题");
  if (actions.some(action => action.issueIds.some(id => !known.has(id)))) {
    throw new Error("整改计划包含当前 QC 不存在的问题 ID，请按已返回的 issues 编号提交");
  }
  const covered = new Set(actions.flatMap(action => action.issueIds));
  const missing = issues.filter(issue => !covered.has(issue.id)).map(issue => issue.id);
  if (missing.length) throw new Error(`整改计划没有覆盖下列 QC 问题：${missing.join("、")}`);
}

export function parseQcPayload(text: string, mode: QcMode, hasAudio = true, requirements: QcRequirement[] = [], timelineEvidence = true, fullVideoEvidence = timelineEvidence) {
  requirements = requirementsForQc(requirements, mode);
  const extracted = extractJsonObject(text);
  const parsed = qcPayload.safeParse(extracted.value);
  const diagnostic = extracted.error ?? (!parsed.success
    ? `质检 JSON 字段不符合约定：${parsed.error.issues.map(issue => `${issue.path.join(".") || "根对象"}（${issue.code}）`).join("；")}。` : "");
  // 模型输出非合法 JSON 属于质检执行失败，不能误判为成片已审。
  if (!parsed.success) throw new Error(`质检输出无效：${diagnostic}`);
  const required = mode === "merged" ? ["video", "audio"] as const : [mode];
  const checks: QcCheck[] = compactQcChecks(parsed.data.checks.filter(check =>
    check.domain === "general" || (required.includes(check.domain) && (check.domain !== "audio" || hasAudio))));
  for (const domain of required) {
    if (checks.some(check => check.domain === domain)) continue;
    const evidence = domain === "video" ? "模型未给出画面判定。"
      : hasAudio ? "模型未给出音轨判定。" : "成片没有可核验的音轨。";
    checks.push({ domain, result: "unverified", evidence });
  }
  const expected = new Map(requirements.map(item => [item.id, item]));
  for (const check of checks) {
    if (!check.requirementId) {
      // 未绑定验收编号且无时间锚的画面描述，只能作为诊断线索。
      if (requirements.length && check.domain === "video" && !check.time && check.result !== "unverified") {
        check.result = "unverified";
        check.evidence = `未绑定具体验收编号且缺少时间证据，需复核。${check.evidence}`;
      }
      continue;
    }
    const requirement = expected.get(check.requirementId);
    if (!requirement) {
      check.result = "unverified";
      check.evidence = `未知验收编号，不能证明合同覆盖。${check.evidence}`;
      continue;
    }
    check.requirement = requirement.text;
    if (requirement.domain && check.domain !== requirement.domain) {
      check.result = "unverified";
      check.evidence = "结论所属的质检域与验收要求不一致。";
      continue;
    }
    // 只有具备足够证据的“通过”才能通过；失败依据仍保留供复核。
    const negativeEvidence = requirement.source.startsWith("mustNotHave") && !fullVideoEvidence;
    const needsVisualTimeline = requirement.domain !== "audio" && !timelineEvidence;
    if (check.result === "pass" && (needsVisualTimeline || !check.time || negativeEvidence)) {
      check.result = "unverified";
      const why = needsVisualTimeline ? "抽帧不足以确认完整时序" : !check.time
        ? "缺少可定位的时间证据" : "离散帧不能证明整段视频未出现禁止项";
      check.evidence = `${why}。${check.evidence}`;
    }
  }
  for (const requirement of requirements) {
    if (checks.some(check => check.requirementId === requirement.id)) continue;
    checks.push({ domain: requirement.domain ?? "video", requirementId: requirement.id, requirement: requirement.text,
      result: "unverified", evidence: "模型未单独验收此项已审要求。" });
  }
  return summarizeQc(checks);
}
