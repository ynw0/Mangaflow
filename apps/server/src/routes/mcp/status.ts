import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().get("/", (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const runtime = u.mcpRuntime.getMcpRuntime();
  const origin = u.mcpControl.getAppOrigin(req);
  const publicSettings = u.mcpOauth.publicMcpSettings();
  res.set("Cache-Control", "no-store").json(success({
    connections: u.mcpControl.listConnections(),
    ...runtime,
    ...publicSettings,
    endpoint: publicSettings.publicUrl ? `${publicSettings.publicUrl}/mcp`
      : ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname) ? runtime.endpoint : `${origin}/mcp`,
  }));
});
