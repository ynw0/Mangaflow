import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { readProduction } from "@/utils/production/config";
import { discoverGemmaQcModels, gemmaTargetId, gemmaModelPrefix, isGemmaModelEnabled } from "@/utils/production/gemmaQcModels";
import { listAiModels } from "@/utils/ai";
import u from "@/utils";

export default Router().get("/", validateFields({ host: z.enum(["local", "autodl"]).optional(), refresh: z.enum(["true", "false"]).optional() }, "query"), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const config = readProduction();
  const host = req.query.host === "local" || req.query.host === "autodl" ? req.query.host : config.gemmaQcHost;
  const targetId = gemmaTargetId(config, host);
  const configured = (config.enabledGemmaQcModels[targetId] ?? []).map(file => ({
    file, id: gemmaModelPrefix + file, label: file, enabled: isGemmaModelEnabled(config, file, host), precision: "未探测",
  }));
  const data = req.query.refresh === "false" ? { host, targetId, models: configured } : await discoverGemmaQcModels(host, AbortSignal.timeout(10000));
  const { qcMethod, qcLevel, qcTrigger, videoQcModelId, audioQcModelId, gemmaQcHost } = config;
  const languageModels = listAiModels().map(item => ({ id: item.modelId, label: item.modelId, video: item.inputs?.video === true || item.inputs?.image === true, audio: item.inputs?.audio === true }));
  res.set("Cache-Control", "no-store").json(success({ ...data, configured, defaults: { qcMethod, qcLevel, qcTrigger, videoQcModelId, audioQcModelId, gemmaQcHost }, languageModels }));
});
