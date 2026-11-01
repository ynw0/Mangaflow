import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { ProviderPrice, ProviderPriceRequest } from "@toonflow/providers";
import { loadMediaProviderSource } from "@/utils/media/provider";

type RuntimeProvider = Awaited<ReturnType<typeof loadMediaProviderSource>>;

const unitSchema = z.string().trim().min(1).max(64);
// ACT: 已安装的旧供应商仍可返回数值报价，统一转换为展示文本。
const priceSchema = z.object({ price: z.string().trim().min(1), tips: z.string() }).or(
  z.object({ amount: z.number().finite().nonnegative(), unit: unitSchema })
    .transform(({ amount, unit }) => ({ price: `${amount} ${unit}`, tips: "以实际扣费为准" })),
);
const prices = new Map<string, { expires: number; value: Promise<ProviderPrice | null> }>();
const accountSecret = randomBytes(32);

function accountId(provider: RuntimeProvider) {
  const config = { ...provider.config };
  if (provider.id === "tfRouter" && typeof config.apiKey === "string") config.apiKey = config.apiKey.trim().replace(/^Bearer(?:\s+|$)/i, "").trim();
  const data = JSON.stringify({ id: provider.id, config }, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
  return createHmac("sha256", accountSecret).update(data).digest("hex");
}

function queryContext(provider: RuntimeProvider, timeout: number) {
  const signal = AbortSignal.timeout(timeout);
  const fetchRequest = provider.queryFetch;
  return { ...provider, signal, tool: { ...provider.tool, fetch: Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return fetchRequest(input, { ...init, signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal });
  }, { preconnect: fetchRequest.preconnect }) as typeof fetch } };
}

async function waitForQuery<T>(query: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return query;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([query, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export async function getProviderPrice(provider: RuntimeProvider, request: ProviderPriceRequest): Promise<ProviderPrice | null> {
  if (!provider.getPrice) return null;
  const now = Date.now();
  for (const [key, cached] of prices) if (cached.expires <= now) prices.delete(key);
  const key = createHash("sha256").update(accountId(provider)).update(provider.sourceRevision).update(JSON.stringify(request)).digest("hex");
  const cached = prices.get(key);
  if (cached) return cached.value;
  // ACT: 报价缓存仅保留哈希与结果，最多 500 项 / 30 秒；不缓存媒体内容。
  if (prices.size >= 500) prices.delete(prices.keys().next().value!);
  const entry = { expires: now + 30000, value: Promise.resolve<ProviderPrice | null>(null) };
  entry.value = (async () => {
    try {
      const context = queryContext(provider, 8000);
      const price = await waitForQuery(Promise.resolve().then(() => provider.getPrice!.call(context, request)), context.signal);
      return price === null ? null : priceSchema.parse(price);
    } catch (error) {
      // ACT: 上游未部署估价或暂时失败时短缓存错误，调用方可显示失败，生成单独降级。
      entry.expires = Date.now() + 5000;
      throw new Error(provider.tool.errorMessage(error) || "价格查询失败");
    }
  })();
  prices.set(key, entry);
  return entry.value;
}
