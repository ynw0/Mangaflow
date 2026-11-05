import { Router } from "express";
import u from "@/utils";
import { oauthEndpoint, validateOauth } from "@/lib/oauthEndpoint";
export default Router().post("/", validateOauth(u.mcpOauth.tokenSchema.shape), oauthEndpoint(async (req, res) => {
  res.json(await u.mcpOauth.exchangeToken(u.mcpOauth.tokenSchema.parse(req.body)));
}));
