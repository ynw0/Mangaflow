// 列出可切换的出图、出视频、质检工作流。同 id 使用内置，数据目录里的不同副本放进 notices。
import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { entries, notices } = await u.production.loadWorkflowCatalog();
  const map = (kind: "image" | "video" | "qc") => entries.filter(item => item.kind === kind).map(item => ({ id: item.id, label: item.label }));
  res.set("Cache-Control", "no-store").json(success({ image: map("image"), video: map("video"), qc: map("qc"), notices }));
});
