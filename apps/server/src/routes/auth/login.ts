import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { accessToken, sameToken, setAccessCookie } from "@/lib/accessToken";

const tokenPattern = /^[A-Za-z0-9._~-]{32,256}$/;

export default Router().post("/", validateFields({ token: z.string().regex(tokenPattern) }), (req, res) => {
  if (!accessToken()) {
    res.status(400).json(error("当前服务不需要访问令牌", null, 400));
    return;
  }
  if (!sameToken(req.body.token)) {
    res.status(401).json(error("访问令牌不正确", null, 401));
    return;
  }
  setAccessCookie(res, req.body.token);
  res.set("Cache-Control", "no-store").json(success({ authenticated: true }));
});
