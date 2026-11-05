import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
export default Router().put("/", validateFields({ mcp: z.boolean(), management: z.boolean(), files: z.boolean(), api: z.boolean() }), (req, res) => {
  u.mcpControl.assertAppRequest(req);
  u.mcpTunnel.requireLocalTunnelRequest(req);
  res.json(success(u.mcpTunnel.saveTunnelAccess(req.body)));
});
