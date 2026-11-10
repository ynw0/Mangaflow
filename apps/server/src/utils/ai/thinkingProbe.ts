// 对每个已配置供应商/模型进行实际 API 能力探测，不根据模型名称推断。
// 由用户在设置界面主动触发；每次测试最多发送简短请求，可能产生少量模型 Token 费用。
import { getConfiguredModel } from "@/utils/ai";

export const probeLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ProbeThinkingLevel = typeof probeLevels[number];
type Trial = { state: "accepted" | "rejected" | "unknown"; message: string; advertised: ProbeThinkingLevel[] };

export function advertisedLevels(message: string) {
  const match = /supported\s+(?:types|values|levels|efforts)(?:\s+are|\s*:)\s*([^\n.]{1,240})/i.exec(message);
  if (!match) return [];
  const candidates = match[1]!.toLowerCase().match(/\b(?:minimal|low|medium|high|xhigh|max)\b/g) ?? [];
  return [...new Set(candidates)].filter((level): level is ProbeThinkingLevel => probeLevels.includes(level as ProbeThinkingLevel));
}

async function trial(configured: ReturnType<typeof getConfiguredModel>, level: ProbeThinkingLevel, signal?: AbortSignal): Promise<Trial> {
  const { provider, model } = configured;
  if (provider.protocol === "anthropic-messages") throw new Error("Anthropic Messages 接口不使用 reasoning_effort；请使用该协议专用的能力配置");
  const baseUrl = configured.baseUrl.replace(/\/+$/, "");
  const path = provider.protocol === "openai-responses" ? "/responses" : "/chat/completions";
  const body = provider.protocol === "openai-responses"
    ? { model: model.id, input: "请仅回复 OK", max_output_tokens: 32, reasoning: { effort: level }, stream: false }
    : { model: model.id, messages: [{ role: "user", content: "请仅回复 OK" }], max_tokens: 32, reasoning_effort: level, stream: false };
  const response = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (response.ok) { await response.body?.cancel(); return { state: "accepted", message: "", advertised: [] }; }
  const text = (await response.text()).slice(0, 3000);
  let message = text;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message ?? text;
  } catch { /* 服务端返回的错误可能不是 JSON */ }
  const advertised = advertisedLevels(message);
  const rejected = response.status === 400 || response.status === 422;
  return { state: rejected && (advertised.length > 0 || /(?:unsupported|not supported|unexpected|invalid|unknown).{0,65}(?:reasoning|effort)|(reasoning|effort).{0,65}(?:unsupported|not supported|unexpected|invalid)/i.test(message)) ? "rejected" : "unknown", message: `HTTP ${response.status}: ${message.slice(0, 340)}`, advertised };
}

export async function probeConfiguredThinkingLevels(providerId: string, modelId: string) {
  const configured = getConfiguredModel(providerId, modelId);
  const first = await trial(configured, "high");
  // 常见兼容接口会在高档被拒绝时直接枚举实际支持的全部档位。
  if (first.state === "rejected" && first.advertised.length) {
    return { levels: probeLevels.filter(level => first.advertised.includes(level)), source: "provider-advertised" as const, verified: ["high"], notice: "已从服务端错误响应中读取明确支持的档位；其他档位尚未逐一调用。" };
  }
  if (first.state === "unknown") throw new Error(`无法确认模型推理等级：${first.message}。未更改原配置。`);
  const accepted: ProbeThinkingLevel[] = first.state === "accepted" ? ["high"] : [];
  const inconclusive: string[] = [];
  for (const level of probeLevels) {
    if (level === "high") continue;
    const result = await trial(configured, level);
    if (result.state === "accepted") accepted.push(level);
    else if (result.advertised.length) {
      const supported = new Set([...accepted, ...result.advertised]);
      return { levels: probeLevels.filter(value => supported.has(value)), source: "provider-advertised" as const, verified: ["high", level], notice: "包含服务端明确列出的支持档位，尚未逐一验证所有档位。" };
    } else if (result.state === "unknown") inconclusive.push(level);
  }
  if (inconclusive.length) throw new Error(`以下档位未能确认：${inconclusive.join("、")}。为避免覆盖配置，请检查服务端接口及模型响应。`);
  return { levels: probeLevels.filter(level => accepted.includes(level)), source: "live-request" as const, verified: [...probeLevels], notice: "接口已接受所列档位；服务商仍可能在内部忽略思考强度。" };
}
