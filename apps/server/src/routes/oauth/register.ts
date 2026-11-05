import { Router } from "express";
import u from "@/utils";
import { oauthEndpoint, validateOauth } from "@/lib/oauthEndpoint";
export default Router().post("/", validateOauth(u.mcpOauth.registrationSchema.shape), oauthEndpoint(async (req, res) => {
  res.status(201).json(await u.mcpOauth.registerClient(u.mcpOauth.registrationSchema.parse(req.body)));
}));
