import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, type CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { getConfiguredModel, getModelThinkingProfile } from "@/utils/ai";

export type SdkThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export function toSdkThinkingLevel(level: string): SdkThinkingLevel {
  // 部分兼容服务提供扩展档位；SDK 用近似内部档位编排思考块，
  // 最终向服务发送的值仍由 onPayload 精确映射（绝不把 ultra 真的发为 max）。
  if (level === "on") return "low" as SdkThinkingLevel;
  if (level === "none") return "off" as SdkThinkingLevel;
  if (level === "ultra") return "max" as SdkThinkingLevel;
  return level as SdkThinkingLevel;
}

export async function createAgentModel(providerId: string, modelId: string, thinkingLevel = "off") {
  const configured = getConfiguredModel(providerId, modelId);
  const { provider, model, baseUrl } = configured;
  // API 能力由当前供应商/模型配置定义，不能拿其他供应商的同名模型作最终依据。
  if (thinkingLevel !== "off" && !model.thinkingLevels?.includes(thinkingLevel)) {
    throw new Error(`模型 ${model.label} 未声明支持思考等级 ${thinkingLevel}；请先探测实际支持档位，再重新选择。`);
  }
  const thinking = getModelThinkingProfile(model.id);
  const hostname = new URL(baseUrl).hostname;
  const bailianPreview = model.id === "qwen4-max-preview" && provider.protocol === "openai-completions"
    && (hostname.endsWith(".maas.aliyuncs.com") || /^dashscope(?:-[a-z0-9]+)*\.aliyuncs\.com$/.test(hostname));
  // 百炼兼容接口的系统指令使用 system，思考模型也不能发 developer。
  const catalogCompat = thinking?.compat;
  const compat = bailianPreview
    ? { ...(catalogCompat && typeof catalogCompat === "object" ? catalogCompat : {}), supportsDeveloperRole: false }
    : catalogCompat;
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider(providerId, {
    api: provider.protocol,
    baseUrl,
    models: [{
      id: model.id, name: model.label, reasoning: thinking ? thinking.reasoning : thinkingLevel !== "off",
      ...(compat ? { compat } : {}),
      ...(thinking?.thinkingLevelMap ? { thinkingLevelMap: thinking.thinkingLevelMap } : {}),
      // ACT: 保留图片输入，由实际供应方判断该模型是否支持。
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow, maxTokens: model.maxOutputTokens,
    }],
  });
  await runtime.setRuntimeApiKey(providerId, provider.apiKey);
  return { ...configured, runtime };
}
