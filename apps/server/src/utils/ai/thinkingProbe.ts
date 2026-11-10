/** 与 warehouse_suit/assistant/model_probe.py 相同的能力判定策略：
 * 模型 /models 声明优先 -> 无效档位哨兵 -> 实际调用枚举 -> 显式开关对照。
 * 只有用户主动点击“探测”才会产生请求；不按模型名称猜测支持情况。
 */
import { getConfiguredModel } from "@/utils/ai";

export const probeLevels = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ProbeThinkingLevel = typeof probeLevels[number];
export type ProbeMode = "effort" | "toggle";
type Trial = { state: "accepted" | "rejected" | "unknown"; reasoning: boolean; error: string };

export function advertisedLevels(message: string) {
  const match = /supported\s+(?:types|values|levels|efforts)(?:\s+are|\s*:)\s*([^\n.]{1,240})/i.exec(message);
  if (!match) return [];
  const candidates = match[1]!.toLowerCase().match(/\b(?:none|minimal|low|medium|high|xhigh|max|ultra)\b/g) ?? [];
  return [...new Set(candidates)].filter((level): level is ProbeThinkingLevel => probeLevels.includes(level as ProbeThinkingLevel));
}

function providerHeaders(key: string) {
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

async function discoverDeclared(configured: ReturnType<typeof getConfiguredModel>) {
  const response = await fetch(configured.baseUrl.replace(/\/+$/, "") + "/models", {
    headers: providerHeaders(configured.provider.apiKey), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return [];
  const body = await response.json() as { data?: unknown };
  const models = Array.isArray(body) ? body : body?.data;
  if (!Array.isArray(models)) return [];
  const entry = models.find(item => item && typeof item === "object" && (item as { id?: string }).id === configured.model.id) as Record<string, unknown> | undefined;
  if (!entry) return [];
  const declared = entry.supported_reasoning_efforts ?? entry.reasoning_efforts;
  if (!Array.isArray(declared)) return [];
  return probeLevels.filter(level => declared.includes(level));
}

async function trial(configured: ReturnType<typeof getConfiguredModel>, extra: Record<string, unknown>): Promise<Trial> {
  const { provider, model } = configured;
  const path = provider.protocol === "openai-responses" ? "/responses" : "/chat/completions";
  const body = provider.protocol === "openai-responses"
    ? { model: model.id, input: "计算 12 加 19，只回答结果。", max_output_tokens: 128, stream: false,
      ...(Object.hasOwn(extra, "reasoning_effort") ? { reasoning: { effort: extra.reasoning_effort } } : extra) }
    : { model: model.id, messages: [{ role: "user", content: "计算 12 加 19，只回答结果。" }],
      max_tokens: 128, stream: false, ...extra };
  try {
    const response = await fetch(configured.baseUrl.replace(/\/+$/, "") + path, {
      method: "POST", headers: providerHeaders(provider.apiKey), body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const raw = (await response.text()).slice(0, 2200);
      let message = raw;
      try {
        const parsed = JSON.parse(raw) as { error?: string | { message?: string }; message?: string };
        message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message ?? raw;
      } catch { /* 兼容非 JSON 错误 */ }
      return { state: response.status >= 400 && response.status < 500 ? "rejected" : "unknown", reasoning: false, error: `HTTP ${response.status}: ${message.slice(0, 240)}` };
    }
    const result = await response.json() as { choices?: { message?: { reasoning_content?: string; reasoning?: unknown } }[]; output?: unknown[] };
    const message = result.choices?.[0]?.message;
    // 成功但没有可辨识的模型输出，不构成一次有效的“accepted”。
    if (!message && !Array.isArray(result.output)) return { state: "unknown", reasoning: false, error: "接口返回成功但没有可识别的模型响应" };
    return { state: "accepted", reasoning: Boolean(message?.reasoning_content || message?.reasoning), error: "" };
  } catch (error) {
    return { state: "unknown", reasoning: false, error: error instanceof Error ? error.message : "网络调用失败" };
  }
}

// 限制并发度与 Token 消耗，不将每个档位串行等待；与 WarehouseClient 服务端探测一致。
async function trialMany(configured: ReturnType<typeof getConfiguredModel>, items: { id: string; fields: Record<string, unknown> }[]) {
  const results = new Map<string, Trial>();
  for (let start = 0; start < items.length; start += 4) {
    const batch = items.slice(start, start + 4);
    const values = await Promise.all(batch.map(item => trial(configured, item.fields)));
    batch.forEach((item, index) => results.set(item.id, values[index]!));
  }
  return results;
}

export async function probeConfiguredThinkingLevels(providerId: string, modelId: string) {
  const configured = getConfiguredModel(providerId, modelId);
  if (configured.provider.protocol === "anthropic-messages") {
    throw new Error("当前探测器针对 OpenAI 兼容接口；Anthropic Messages 的思考预算不能按 reasoning_effort 探测");
  }
  // 第一步：服务端模型目录显式声明的优先（和 warehouse model_probe.py 一致）。
  let declared: ProbeThinkingLevel[] = [];
  try { declared = await discoverDeclared(configured); }
  catch { /* /models 非强制，继续用实测验证 */ }
  if (declared.length) return {
    levels: declared, mode: "effort" as ProbeMode, source: "model-declaration",
    notice: "档位由当前服务的 /models 声明；未逐一验证实际采样行为。",
  };

  // 第二步：无效努力等级哨兵。若服务默默接受非法值，其他 accepted 也不能证明支持。
  const sentinel = await trial(configured, { reasoning_effort: "__invalid_effort_probe__" });
  if (sentinel.state === "rejected") {
    const checks = await trialMany(configured, probeLevels.map(level => ({ id: level, fields: { reasoning_effort: level } })));
    const accepted = probeLevels.filter(level => checks.get(level)?.state === "accepted");
    if (accepted.length) {
      const uncertain = probeLevels.filter(level => checks.get(level)?.state === "unknown");
      return { levels: accepted, mode: "effort" as ProbeMode, source: "live-validation",
        notice: uncertain.length ? `档位 ${uncertain.join("、")} 无法确认，未列为可用；已确认服务拒绝无效 reasoning_effort。` : "逐档实测成功，并确认服务会拒绝无效 reasoning_effort。" };
    }
  } else if (sentinel.state === "unknown") {
    throw new Error(`思考档位探测未完成：${sentinel.error}；保留现有配置。`);
  }

  // 第三步：兼容只支持 enable_thinking 布尔开关的服务。
  if (configured.provider.protocol === "openai-completions") {
    const checks = await trialMany(configured, [
      { id: "off", fields: { chat_template_kwargs: { enable_thinking: false } } },
      { id: "on", fields: { chat_template_kwargs: { enable_thinking: true } } },
    ]);
    const off = checks.get("off"), on = checks.get("on");
    if (off?.state === "accepted" && on?.state === "accepted" && !off.reasoning && on.reasoning) {
      return { levels: ["on"], mode: "toggle" as ProbeMode, source: "observable-toggle",
        notice: "已观察到 enable_thinking=false/true 的思考内容差异；关闭会发送显式 false。" };
    }
  }
  return { levels: [], mode: "effort" as ProbeMode, source: "unverified",
    notice: "当前服务未提供可验证的思考等级；只保留“服务默认”（不发送等级参数）。" };
}
