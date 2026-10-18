// 开机或关机。开机只发请求，不等到 running。
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ action: z.enum(["on", "off"]) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const action = req.body.action === "off" ? "off" : "on";
  res.json(success(await u.production.autodlPower(action)));
});
