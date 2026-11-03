import axios from "axios";
import { customProviders, settings } from "@/stores/settings";

type TfRequestOptions = { apiKey?: string; signal?: AbortSignal };

export type TfSponsor = { id: number; name: string; logoUrl: string; readme: string };
type TfResponse<T> = { code: number; data: T; message?: string };

type TfPlugin = {
  id: number;
  name: string;
  identifier: string;
  userId: number;
  supplier: string;
  type: "node" | "skill" | "tool" | "agent" | "ext";
  state: number;
  desc: string;
  link: string;
  fileName: string;
  creationTime: number;
  installation: number;
  download: number;
  version: string;
  updateById: number | null;
  isCollected: boolean;
};

type TfPluginParams = {
  page: number;
  limit: number;
  type: "all" | "node" | "skill" | "tool" | "agent" | "ext" | "my" | "collection";
  searchKeyword?: string;
};

export function isTfRouterProvider(provider: { id: string; apiUrl: string }) {
  return provider.id.toLowerCase() === "tfrouter" && URL.canParse(provider.apiUrl)
    && new URL(provider.apiUrl).origin === "https://api.toonflow.net";
}

const client = axios.create({ baseURL: "https://api.toonflow.net" });

export function getTfApiKey() {
  const provider = customProviders.value.find(isTfRouterProvider);
  const mediaConfigs = settings.value.mediaProviderConfigs as Record<string, { apiKey?: unknown }> | undefined;
  return [provider?.apiKey, mediaConfigs?.tfRouter?.apiKey]
    .map(key => typeof key === "string" ? key.trim().replace(/^Bearer(?:\s+|$)/i, "").trim() : "")
    .find(Boolean) ?? "";
}

// 与服务端 lib/secrets.ts 的哨兵一致。已保存的密钥不发回浏览器，也不再由浏览器转发。
const redactedSecret = "[REDACTED]";

function oneTimeKey(apiKey?: string) {
  const key = apiKey?.trim().replace(/^Bearer(?:\s+|$)/i, "").trim() ?? "";
  if (!key || key === redactedSecret) return undefined;
  return key;
}

function responseData<T>(response: TfResponse<T>, fallback = "TF-Router 请求失败"): T {
  if (!response || typeof response !== "object" || typeof response.code !== "number") throw new Error("TF-Router 响应格式不正确");
  if (response.code !== 200) throw new Error(response.message || fallback);
  return response.data;
}

export default {
  async getSponsorList(options?: Pick<TfRequestOptions, "signal">): Promise<TfSponsor[]> {
    const { data } = await client.post<TfResponse<TfSponsor[]>>("/web/sponsor/getSponsorList", null, { signal: options?.signal, timeout: 20000 });
    const sponsors = responseData(data, "加载赞助商失败");
    if (!Array.isArray(sponsors) || sponsors.some(item => !item || !Number.isSafeInteger(item.id) || item.id < 1
      || typeof item.name !== "string" || typeof item.logoUrl !== "string" || typeof item.readme !== "string")) throw new Error("赞助商响应格式不正确");
    return sponsors;
  },

  async getPlugIn(params: TfPluginParams, options?: TfRequestOptions) {
    if (!Number.isSafeInteger(params.page) || params.page < 1) throw new Error("页码必须为正整数");
    if (!Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 50) throw new Error("每页数量必须为 1 至 50 的整数");
    const key = oneTimeKey(options?.apiKey);
    const { data } = await axios.post<TfResponse<{ list: TfPlugin[]; total: number }>>("/api/tf/plugins", { ...params, ...(key ? { apiKey: key } : {}) }, {
      headers: { "x-toonflow-workspace": "1" }, signal: options?.signal, timeout: 25000,
    });
    return responseData(data, "加载插件市场失败");
  },

  async toggleCollection(pluginId: number, options?: TfRequestOptions): Promise<{ collected: boolean }> {
    if (!Number.isSafeInteger(pluginId) || pluginId < 1) throw new Error("插件 ID 必须为正整数");
    const key = oneTimeKey(options?.apiKey);
    const { data } = await axios.post<TfResponse<{ collected: boolean }>>("/api/tf/collection", { pluginId, ...(key ? { apiKey: key } : {}) }, {
      headers: { "x-toonflow-workspace": "1" }, signal: options?.signal, timeout: 25000,
    });
    const collection = responseData(data, "更新插件收藏失败");
    if (typeof collection?.collected !== "boolean") throw new Error("插件收藏响应格式不正确");
    return collection;
  },
};
