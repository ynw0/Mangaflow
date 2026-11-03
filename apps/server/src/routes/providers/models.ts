import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { redactedSecret } from "@/lib/secrets";
import u from "@/utils";

const router = Router();

function storedProviderKey(apiUrl: string, protocol: string) {
  const settings = u.conf.get("settings", {}) as { customProviders?: { apiUrl?: string; protocol?: string; apiKey?: unknown }[] };
  const keys = (settings.customProviders ?? [])
    .filter(item => item.apiUrl === apiUrl && item.protocol === protocol && typeof item.apiKey === "string")
    .map(item => (item.apiKey as string).trim())
    .filter(item => item && item !== redactedSecret);
  const unique = new Set(keys);
  return unique.size === 1 ? [...unique][0] : "";
}

export default router.post("/", validateFields({
  apiUrl: z.url().refine(value => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, "请填写不含查询参数的 HTTP API 基础地址"),
  protocol: z.enum(["openai-completions", "openai-responses", "anthropic-messages"]),
  apiKey: z.string().max(8192),
}), async (req, res) => {
  const { apiUrl, protocol, apiKey } = req.body as { apiUrl: string; protocol: string; apiKey: string };
  const typed = apiKey.trim();
  const key = typed === redactedSecret ? storedProviderKey(apiUrl, protocol) : apiKey;
  if (typed === redactedSecret && !key) return res.status(400).json(error("请重新填写 API Key"));
  res.json(success(await u.ai.fetchProviderModels({ apiUrl, protocol, apiKey: key })));
});
