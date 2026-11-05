import { Router } from "express";
import u from "@/utils";
import { oauthEndpoint } from "@/lib/oauthEndpoint";
export default Router().get("/", oauthEndpoint((_req, res) => {
  const origin = u.mcpOauth.oauthOrigin();
  res.json({ issuer: origin, authorization_endpoint: `${origin}/api/oauth/authorize`, token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`, revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: ["mcp"] });
}));
