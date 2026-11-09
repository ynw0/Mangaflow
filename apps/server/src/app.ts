import logger from "morgan";
import express from "express";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "@toonflow/file";
import type { Request, Response, NextFunction } from "express";
import buildRoute from "@/core";
import { errorFromCause } from "@/lib/responseFormat";
import desktopRequest from "@/lib/desktop";
import { getRuntimePlatform } from "@/lib/platform";
import initializePlugins from "@/utils/plugins/initialize";
import syncBuiltinSkills from "@/utils/skills/builtin";
import { languageRequest, resolveRequestLocale, runWithLocale, setLocaleFallback, translateError, translateMessage } from "@/lib/i18n";
import { detectLocale, normalizeLocale } from "@toonflow/i18n";
import { isPublicRequest, requireAccessToken } from "@/lib/accessToken";

const autoInstallProviders = ["qwenImage.ts"];

export async function createApp({
  webRoot,
  appVersion = "",
  dataDirectory,
  toolsRoot,
  nodesRoot,
  extRoot,
  providersRoot,
  skillsRoot,
  agentsRoot,
  pluginRevision,
}: {
  webRoot: string;
  appVersion?: string;
  dataDirectory?: string;
  toolsRoot?: string;
  nodesRoot?: string;
  extRoot?: string;
  providersRoot?: string;
  skillsRoot?: string;
  agentsRoot?: string;
  pluginRevision?: string;
}) {
  // conf 由下方的路由动态加载，必须先确定整个进程共用的数据目录。
  if (dataDirectory) process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory);
  const { default: conf } = await import("@/utils/conf");
  setLocaleFallback(() => normalizeLocale((conf.get("settings", {}).ui as { language?: unknown } | undefined)?.language)
    ?? detectLocale([Intl.DateTimeFormat().resolvedOptions().locale]));
  if (dataDirectory && toolsRoot)
    await initializePlugins(resolve(dataDirectory, "tools"), toolsRoot, /^[a-z][a-zA-Z0-9]*\.tool\.js$/, pluginRevision);
  if (dataDirectory && nodesRoot) await initializePlugins(resolve(dataDirectory, "nodes"), nodesRoot, /^[a-z][a-zA-Z0-9]*\.umd\.js$/, pluginRevision);
  if (dataDirectory && extRoot) {
    const { default: initializeExt } = await import("@/utils/plugins/initializeExt");
    await initializeExt(resolve(dataDirectory, "ext"), extRoot, pluginRevision);
  }
  // ACT: 内置媒体供应商随构建同步，其他供应商文件和独立保存的配置保留。
  if (dataDirectory && providersRoot) {
    const sourceDirectory = resolve(providersRoot, "media");
    let providerRevision = pluginRevision;
    if (providerRevision === undefined) {
      const hash = createHash("sha256");
      for (const name of autoInstallProviders) {
        const source = await readFile(resolve(sourceDirectory, name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return Buffer.alloc(0);
          throw error;
        });
        hash.update(name).update("\0").update(source).update("\0");
      }
      providerRevision = hash.digest("hex");
    }
    await initializePlugins(resolve(dataDirectory, "providers"), sourceDirectory, autoInstallProviders, providerRevision);
  }
  // 技能首次安装后，未改动的内置副本随模板覆盖；改过的留下待合并标记。
  if (dataDirectory && skillsRoot) {
    const skillsDirectory = resolve(dataDirectory, "skills");
    await initializePlugins(skillsDirectory, skillsRoot);
    await syncBuiltinSkills(skillsDirectory, skillsRoot);
  }
  if (dataDirectory && agentsRoot) await initializePlugins(resolve(dataDirectory, "agents"), agentsRoot);
  const app = express();
  app.locals.appVersion = appVersion;

  if (getRuntimePlatform().development) {
    await buildRoute();
    app.use(logger("dev"));
  }
  app.use((request, response, next) => {
    const oauthPublic = /^\/api\/oauth\/(resource|metadata|register|token|revoke)\/?$/.test(request.path)
      || request.path.startsWith("/.well-known/oauth-");
    if (oauthPublic) {
      response.set("Access-Control-Allow-Origin", "*");
      response.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      response.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    }
    const origin = request.get("origin");
    if (origin && !oauthPublic) {
      let allowed = false;
      try {
        const url = new URL(origin);
        allowed = (url.protocol === "http:" || url.protocol === "https:") && url.host === request.get("host");
      } catch {
        allowed = false;
      }
      if (allowed) {
        response.set("Access-Control-Allow-Origin", origin);
        response.set("Vary", "Origin");
        response.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE");
        const requested = request.get("access-control-request-headers");
        if (requested) response.set("Access-Control-Allow-Headers", requested);
      }
    }
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });
  app.use(languageRequest);
  // 标准发现地址与自动生成的 OAuth 路由共用同一个接口实现。
  app.use("/.well-known/oauth-authorization-server", (await import("@/routes/oauth/metadata")).default);
  app.use("/.well-known/oauth-protected-resource", (await import("@/routes/oauth/resource")).default);
  app.use(requireAccessToken);
  app.use("/a2a", express.json({ limit: "2mb" }));
  app.use(["/api/workspaces/files/write", "/api/assets/save"], express.raw({ type: "application/octet-stream", limit: "100mb" }));
  // 安装包、技能正文、带图片的生成上下文和设置快照单独放宽。其余 JSON 收紧到 2 MB。
  const largeJsonPaths = [
    "/api/settings/save", "/api/ai/generate", "/api/singleAgent/run", "/api/agent",
    "/api/skills/install", "/api/skills/save", "/api/nodes/install", "/api/nodes/save",
    "/api/tools/install", "/api/tools/save", "/api/ext/install", "/api/ext/save",
    "/api/agents/install", "/api/agents/save", "/api/providers/debug/run", "/api/providers/debug/inspect",
    "/api/desktop/clipboard/write", "/api/production/workflows/upload",
  ];
  app.use(largeJsonPaths, express.json({ limit: "40mb" }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use("/api/desktop", desktopRequest);

  const { default: initializeProviderModels } = await import("@/utils/ai/initialize");
  await initializeProviderModels();
  const router = await import("@/router");
  router.default(app);
  const [{ createMcpRouter }, { getMcpTools }, { authorizeMcp }, { skillResources }] = await Promise.all([
    import("@toonflow/mcp"),
    import("@/utils/mcp/tools"),
    import("@/utils/mcp/control"),
    import("@/utils/mcp/resources"),
  ]);
  const { oauthChallenge, mcpSessionVersion } = await import("@/utils/mcp/oauth");
  app.use("/mcp", createMcpRouter({ getTools: getMcpTools, authorize: authorizeMcp, resources: skillResources,
    challenge: oauthChallenge, authorizationVersion: mcpSessionVersion,
    jsonResponse: isPublicRequest,
    runInRequest: (request, operation) => runWithLocale(resolveRequestLocale(request.get("accept-language")), operation),
    translate: translateMessage,
    translateError,
  }));
  const { createA2aRouter } = await import("@/agent/a2a");
  app.use("/a2a", createA2aRouter());
  app.use(express.static(webRoot));

  // 错误处理
  app.use((err: Error & { status?: number }, request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(err);
    console.error(err);
    const body = errorFromCause(err);
    response.status(body.code).json(body);
  });

  const { initializeMobileLinkRuntime } = await import("@/utils/mobileLink");
  initializeMobileLinkRuntime(app);
  const { resumePendingAutomaticQc } = await import("@/utils/production/videoRecords");
  void resumePendingAutomaticQc().then(count => {
    if (count) console.info(`已恢复 ${count} 条中断的自动视频 QC 任务`);
  }).catch(error => console.error("恢复自动视频 QC 任务失败", error));
  return app;
}
