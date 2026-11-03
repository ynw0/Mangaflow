// 插件市场只转发两个固定接口。密钥留在服务端，不把任意地址开放成代理。
import { redactedSecret } from "@/lib/secrets";
import u from "@/utils";

const origin = "https://api.toonflow.net";

type Provider = { id?: string; apiUrl?: string; apiKey?: string };

export function readTfApiKey() {
  const settings = u.conf.get("settings", {}) as {
    customProviders?: Provider[];
    mediaProviderConfigs?: Record<string, { apiKey?: string }>;
  };
  const provider = settings.customProviders?.find(item => {
    if (item.id?.toLowerCase() !== "tfrouter" || !item.apiUrl || !URL.canParse(item.apiUrl)) return false;
    return new URL(item.apiUrl).origin === origin;
  });
  const keys = [provider?.apiKey, settings.mediaProviderConfigs?.tfRouter?.apiKey];
  return keys.map(key => typeof key === "string" ? key.trim().replace(/^Bearer(?:\s+|$)/i, "").trim() : "")
    .find(key => key && key !== redactedSecret) ?? "";
}

export function resolveTfApiKey(oneTime?: string) {
  const typed = oneTime?.trim().replace(/^Bearer(?:\s+|$)/i, "").trim() ?? "";
  if (typed && typed !== redactedSecret) return typed;
  return readTfApiKey();
}

export async function callTf(path: "/v1/plugin/getPlugin" | "/v1/plugin/toggleCollection", body: unknown, apiKey: string) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as { code?: unknown; data?: unknown; message?: unknown } | null;
  if (!payload || typeof payload.code !== "number") throw Object.assign(new Error("TF-Router 响应格式不正确"), { status: 502 });
  if (payload.code !== 200) {
    const message = typeof payload.message === "string" && payload.message ? payload.message : "TF-Router 请求失败";
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw Object.assign(new Error(message), { status });
  }
  return payload.data;
}
