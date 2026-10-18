// 用 Token 列出 AutoDL 实例，方便填 UUID。
import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store").json(success(await u.production.listAutodlInstances()));
});
