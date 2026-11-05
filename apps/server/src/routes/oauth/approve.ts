import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { oauthEndpoint, validateOauth } from "@/lib/oauthEndpoint";
export default Router().post("/", validateOauth({ id: z.string().max(100), token: z.string().max(256), decision: z.enum(["approve", "deny"]) }), oauthEndpoint((req, res) => {
  if (req.get("origin") !== u.mcpOauth.oauthOrigin()) { res.status(403).json({ error: "access_denied" }); return; }
  res.redirect(303, u.mcpOauth.approveAuthorization(req.body.id, req.body.token, req.body.decision === "approve"));
}));
