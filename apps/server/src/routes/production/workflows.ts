// 列出可切换的出图、出视频工作流。内置项保留，额外目录只追加新名字。
import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const entries = await u.production.listWorkflowCatalog();
  const map = (kind: "image" | "video") => entries.filter(item => item.kind === kind).map(item => ({ id: item.id, label: item.label }));
  res.set("Cache-Control", "no-store").json(success({ image: map("image"), video: map("video") }));
});
