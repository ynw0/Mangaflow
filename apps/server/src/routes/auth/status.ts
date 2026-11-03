import { Router } from "express";
import { success } from "@/lib/responseFormat";
import { accessStatus } from "@/lib/accessToken";

export default Router().get("/", (req, res) => {
  res.set("Cache-Control", "no-store").json(success(accessStatus(req)));
});
