import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
export default Router().post("/", (req, res) => {
  u.mcpControl.assertAppRequest(req);
  u.mcpTunnel.requireLocalTunnelRequest(req);
  res.json(success(u.mcpTunnel.startTunnelInstall()));
});
