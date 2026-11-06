import { Router } from "express";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
export default Router().put("/", validateFields({ port: u.mcpTunnel.tunnelPortSchema }), (req, res) => {
  u.mcpControl.assertAppRequest(req);
  u.mcpTunnel.requireLocalTunnelRequest(req);
  res.json(success({ port: u.mcpTunnel.saveTunnelPort(req.body.port) }));
});
