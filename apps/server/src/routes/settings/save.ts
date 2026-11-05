import u from "@/utils";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { restoreSettingsSecrets } from "@/lib/secrets";
import { success } from "@/lib/responseFormat";
import { maxSystemPromptLength } from "@/agent/runtime/prompt";
import { t } from "@/lib/i18n";

const router = Router();

export default router.put("/", validateFields({ settings: z.record(z.string(), z.json()).and(z.object({
  agentSystemPrompt: z.string().max(maxSystemPromptLength, { error: () => t`系统提示词不能超过 ${maxSystemPromptLength} 个字符` }).optional(),
  desktopUpdateSource: z.enum(["official", "github", "custom"]).optional(),
  desktopUpdateCustomUrl: z.string().max(2048).refine(value => !value || u.desktop.isValidUpdateUrl(value),
    "自定义更新源必须是不含账号、查询参数或锚点的 HTTP(S) 地址").optional(),
  mcp: u.mcpOauth.mcpSettingsSchema.optional(),
})).refine(value => value.desktopUpdateSource !== "custom" || !!value.desktopUpdateCustomUrl, {
  path: ["desktopUpdateCustomUrl"], message: "选择自定义更新源前，请先填写有效地址",
}) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { settings } = req.body;
  const previousSettings = u.conf.get("settings", {});
  const previousMcp = previousSettings.mcp as { publicUrl?: string } | undefined;
  if (settings.mcp?.publicUrl !== previousMcp?.publicUrl) u.mcpTunnel.useManualPublicUrl();
  u.removeLegacySettings(settings);
  u.cleanNodeMenuSettings(settings);
  const nextSettings = restoreSettingsSecrets(settings, previousSettings);
  u.conf.set("settings", nextSettings);
  const [models] = await Promise.all([u.ai.refreshProviderModels(previousSettings), u.mcpRuntime.reloadMcpRuntime()]);
  res.json(success({ ...models, nodeMenu: u.conf.get("settings.general.nodeMenu") ?? null }, "设置已保存"));
});
