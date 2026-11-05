import { z } from "zod";
import type { QcCheck, QcVideoResult } from "@toonflow/tools-scaffold/runtime";

export type QcMode = "video" | "audio" | "merged";

const qcPayload = z.object({
  checks: z.array(z.object({
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
    text: check.time ? `${check.time} ${check.evidence}` : check.evidence,
  }));
  const status = checks.some(check => check.result === "fail") ? "rejected"
    : checks.length && findings.length === 0 ? "ok" : "unverified";
  return { status, checks, findings };
}

export function parseQcPayload(text: string, mode: QcMode, hasAudio = true) {
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
  return summarizeQc(checks);
}
