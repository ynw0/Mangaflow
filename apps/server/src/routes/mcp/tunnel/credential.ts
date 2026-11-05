import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
export default Router().get("/", (req, res) => {
  u.mcpControl.assertAppRequest(req);
  u.mcpTunnel.requireLocalTunnelRequest(req);
  res.set("Cache-Control", "no-store").json(success({ token: u.mcpOauth.oauthOwnerToken() }));
});
