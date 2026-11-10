import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, type CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { getConfiguredModel, getModelThinkingProfile } from "@/utils/ai";

export type SdkThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export function toSdkThinkingLevel(level: string): SdkThinkingLevel {
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
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider(providerId, {
    api: provider.protocol,
    baseUrl,
    models: [{
      id: model.id, name: model.label, reasoning: thinking ? thinking.reasoning : thinkingLevel !== "off",
      ...(thinking?.compat ? { compat: thinking.compat } : {}),
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
