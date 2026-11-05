import { Router } from "express";
import u from "@/utils";
import { oauthEndpoint } from "@/lib/oauthEndpoint";
export default Router().get("/", oauthEndpoint((_req, res) => {
  const origin = u.mcpOauth.oauthOrigin();
  res.json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ["mcp"], bearer_methods_supported: ["header"] });
}));
