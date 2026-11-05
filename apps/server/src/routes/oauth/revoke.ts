import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { oauthEndpoint, validateOauth } from "@/lib/oauthEndpoint";
export default Router().post("/", validateOauth({ token: z.string().max(200), client_id: z.string().max(200) }), oauthEndpoint(async (req, res) => {
  await u.mcpOauth.revokeToken(req.body.token, req.body.client_id);
  res.status(200).end();
}));
