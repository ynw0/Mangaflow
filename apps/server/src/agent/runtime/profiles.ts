import { z } from "zod";
import conf from "@/utils/conf";
import { getConfiguredModel } from "@/utils/ai";

// 各专业子任务使用统一职责名；无显式配置时沿用当前主 Agent 或通用子任务模型。
export const agentProfileRoles = ["subAgent", "story", "character", "scene", "prop", "team", "videoDirector", "videoReviewer"] as const;
export type AgentProfileRole = (typeof agentProfileRoles)[number];
export type AgentModelSelection = { providerId: string; modelId: string; thinkingLevel: string };
const supportedLevels = ["off", "none", "on", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
const profileSchema = z.strictObject({
  modelKey: z.string().max(1024).optional(),
  thinkingLevel: z.enum(["inherit", ...supportedLevels]).optional(),
});
export const agentProfilesSchema = z.partialRecord(z.enum(agentProfileRoles), profileSchema);

function readProfiles() {
  return agentProfilesSchema.parse(conf.get("settings", {}).agentProfiles ?? {});
}

function applyProfile(base: AgentModelSelection, role: AgentProfileRole, profile: z.infer<typeof profileSchema> | undefined) {
  if (!profile) return { ...base, configured: false };
  let { providerId, modelId, thinkingLevel } = base;
  if (profile.modelKey) {
    let parsed: unknown;
    try { parsed = JSON.parse(profile.modelKey); }
    catch { throw new Error(`${role} 的模型配置无效，请在 Agent 配置中重新选择`); }
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some(value => typeof value !== "string" || !value.trim())) {
      throw new Error(`${role} 的模型配置无效，请在 Agent 配置中重新选择`);
    }
    [providerId, modelId] = parsed as [string, string];
    // 换模型不沿用上一个模型的推理档位，需由用户显式选择。
    if (!profile.thinkingLevel || profile.thinkingLevel === "inherit") thinkingLevel = "off";
  }
  if (profile.thinkingLevel && profile.thinkingLevel !== "inherit") thinkingLevel = profile.thinkingLevel;
  const selected = getConfiguredModel(providerId, modelId);
  if (profile.thinkingLevel && profile.thinkingLevel !== "inherit" && thinkingLevel !== "off"
    && !selected.model.thinkingLevels?.includes(thinkingLevel)) {
    throw new Error(`${role} 配置的 ${thinkingLevel} 不在模型 ${selected.model.label} 的已声明思考档位内，请修改 Agent 配置`);
  }
  return { providerId, modelId, thinkingLevel, configured: true };
}

export function resolveAgentProfile(role: AgentProfileRole, main: AgentModelSelection): AgentModelSelection {
  const profiles = readProfiles();
  const general = role !== "subAgent" && role !== "videoDirector" && role !== "videoReviewer"
    ? applyProfile(main, "subAgent", profiles.subAgent)
    : { ...main, configured: false };
  const base = { providerId: general.providerId, modelId: general.modelId, thinkingLevel: general.thinkingLevel };
  const selected = applyProfile(base, role, profiles[role]);
  if (selected.configured) return { providerId: selected.providerId, modelId: selected.modelId, thinkingLevel: selected.thinkingLevel };
  // 不应把支持 xhigh 但不支持 high 的模型强制降到 high（会触发 400）。
  const levels = getConfiguredModel(base.providerId, base.modelId).model.thinkingLevels ?? [];
  if (role === "videoDirector" && base.thinkingLevel === "xhigh" && levels.includes("high")) return { ...base, thinkingLevel: "high" };
  if (role === "videoReviewer" && ["high", "xhigh"].includes(base.thinkingLevel) && levels.includes("medium")) return { ...base, thinkingLevel: "medium" };
  return base;
}
