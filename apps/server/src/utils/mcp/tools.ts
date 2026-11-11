import { t } from "@/lib/i18n";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { realpath, stat, mkdir, readdir, lstat, rm, rmdir, readFile } from "@toonflow/file";
import { z } from "zod";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import type { McpTool } from "@toonflow/mcp";
import { createAgentTools } from "@/agent/tools";
import { run as runAgent } from "@/agent";
import { videoTemplateSearch } from "@/agent/videoPrompt/templates";
import conf from "@/utils/conf";
import { callControl, getConnection, listConnections } from "@/utils/mcp/control";
import { appOperations, runAppOperation } from "@/utils/mcp/operations";
import { listTools } from "@/utils/plugins/tools";
import { isWithin, lockWorkspaceFiles, protectWorkspaceRoot, renameWorkspaceFile, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";
import { getRuntimePlatform } from "@/lib/platform";
import { externalVideoPrompt, videoPromptSchema } from "@/utils/mcp/videoPrompt";
import { getMcpTask, startMcpTask } from "@/utils/mcp/tasks";
import { readProduction } from "@/utils/production/config";

const targetSchema = z.strictObject({ connectionId: z.uuid().optional(), directory: z.string().min(1).max(4096).optional(), canvasId: z.string().min(1).max(256).optional() });
const requestSchema = z.strictObject({ target: targetSchema.optional(), args: z.record(z.string(), z.unknown()), taskId: z.uuid().optional(), modelCallConfirmed: z.boolean().optional() });
let authorizationController = new AbortController();
for (const key of ["settings.mcp.enabled", "settings.mcp.token", "settings.mcp.authMode", "settings.mcp.publicUrl"] as const) conf.onDidChange(key, () => {
  authorizationController.abort();
  authorizationController = new AbortController();
});

async function resolveDirectory(directory?: string) {
  if (!directory || !isAbsolute(directory)) throw new Error("请在 target.directory 指定绝对工作目录，或先打开项目");
  const path = await realpath(directory);
  if (!(await stat(path)).isDirectory()) throw new Error("工作目录不是文件夹");
  if (!getRuntimePlatform().local) {
    const root = await realpath(resolve(dirname(conf.path), "workspaces"));
    if (!isWithin(root, path)) throw new Error("服务器部署只能使用 data/workspaces 内的工作区");
  }
  return path;
}

async function resolveTarget(target: z.infer<typeof targetSchema> = {}, requireDirectory = true) {
  const requestedDirectory = target.directory ? await resolveDirectory(target.directory) : undefined;
  const connection = getConnection(target.connectionId, requestedDirectory);
  if (target.connectionId && requestedDirectory && connection?.state.directory !== requestedDirectory) throw new Error("目标页面的工作区已切换，请重新获取 getAppState");
  if (target.canvasId && connection?.state.canvasId !== target.canvasId) throw new Error("目标画布已切换，请重新获取 getAppState");
  const directory = requireDirectory ? requestedDirectory ?? await resolveDirectory(connection?.state.directory ?? undefined) : undefined;
  return { connection, directory };
}

function wrapTool(name: string, description: string, schema: object, execute: (args: Record<string, unknown>, target: z.infer<typeof targetSchema>, signal: AbortSignal) => Promise<unknown>): McpTool {
  const background = ["generateImage", "generateVideo", "generateAudio", "qcVideo", "runAgent"].includes(name);
  const mayRunQc = ["qcVideo", "generateVideo", "nodeTools"].includes(name);
  // 插件 JSON Schema 的根引用在包裹后仍指向原来的参数对象。
  const argsSchema = JSON.parse(JSON.stringify(schema).replace(/"\$ref":"#(?=\/|")/g, '"$ref":"#/properties/args'));
  return {
    name, description: description + (background ? " 此调用启动后台任务，必须提供顶层 taskId(UUID)。立即返回任务状态；用 getMcpTask 查询，同一任务重连沿用原 taskId，禁止因等待超时换 ID 重提。" : ""),
    inputSchema: { type: "object", properties: { target: z.toJSONSchema(targetSchema), args: argsSchema,
      ...(background ? { taskId: { type: "string", format: "uuid" } } : {}),
      ...(mayRunQc ? { modelCallConfirmed: { type: "boolean", description: "已明确告知用户本次会调用设置中的专用 QC 模型并获授权时填 true。主 Agent 抽帧模式不需要。" } } : {}) }, required: background ? ["args", "taskId"] : ["args"], additionalProperties: false },
    async execute(input, signal) {
      const { args, target = {}, taskId, modelCallConfirmed } = requestSchema.parse(input);
      const generatesVideo = name === "generateVideo" || name === "nodeTools" && args.name === "node:generateVideo";
      if (name === "qcVideo" || generatesVideo) {
        const policy = readProduction();
        if (policy.qcLevel !== "none" && policy.qcMethod !== "agentFrames"
          && (name === "qcVideo" || generatesVideo && policy.qcTrigger === "auto") && modelCallConfirmed !== true) {
          throw new Error("当前设置会额外调用专用 QC 模型；请先明确取得用户授权并传 modelCallConfirmed=true，或由用户将质检方式改为主 Agent 抽帧验收");
        }
      }
      if (background) {
        if (!taskId) throw new Error("长任务必须提供 taskId，以便重连查询并防止重复执行");
        const { directory, connection } = await resolveTarget(target);
        const fixedTarget = { ...target, directory, ...(connection ? { connectionId: connection.id } : {}) };
        // ComfyUI 的持久化任务继续复用原 generationId，不引入第二次提交。
        const parameters = name === "generateVideo" && args.providerId === "comfyui" ? { ...args, generationId: args.generationId ?? taskId } : args;
        return startMcpTask({ taskId, directory: directory!, tool: name, input: { args: parameters, canvasId: target.canvasId },
          signal: authorizationController.signal, execute: taskSignal => execute(parameters, fixedTarget, taskSignal) });
      }
      return execute(args, target, signal);
    },
  };
}

const uiSchemas = {
  openProject: z.strictObject({ directory: z.string().min(1).max(4096) }),
  switchPanel: z.strictObject({ panel: z.enum(["canvas", "document"]) }),
  getDocument: z.strictObject({}),
  openDocument: z.strictObject({ path: z.string().max(4096).optional(), canvasPath: z.string().max(4096).optional(), nodeId: z.string().max(256).optional(), handleId: z.string().max(256).optional() }),
  writeDocument: z.strictObject({ text: z.string().max(10_000_000), expectedText: z.string().max(10_000_000) }),
  getSettings: z.strictObject({}),
  updateSettings: z.strictObject({ patch: z.record(z.string(), z.json()).refine(patch => !["mcp", "stores"].some(key => Object.hasOwn(patch, key)), "不能通过 MCP 修改连接凭证或项目列表") }),
};
const uiDescriptions: Record<keyof typeof uiSchemas, string> = {
  openProject: "在目标 MangaFlow 页面打开已有工作目录，并等待工作区就绪；操作前获取 getAppState 的 connectionId。",
  switchPanel: "切换工作区的 canvas 画布或 document 文档面板，先保存当前编辑。",
  getDocument: "读取当前文档内容和选择状态。writeDocument 必须携带本次读取的 text 作为 expectedText。",
  openDocument: "打开工作区中的文档文件(path)，或画布中的文本节点(canvasPath、nodeId，可选handleId)。",
  writeDocument: "通过文档编辑器保存当前文档；expectedText 必须匹配当前内容，防止覆盖用户新输入。",
  getSettings: "读取页面当前设置，访问凭证脱敏。",
  updateSettings: "合并保存指定顶层设置项，同时更新页面；不修改 mcp 凭证与 stores 项目列表，嵌套设置应先读取再合并。",
};

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /(?:api.?key|access.?token|refresh.?token|password|secret|authorization)$|^token$/i.test(key) ? (item ? "[REDACTED]" : "") : redactSecrets(item)]));
}

async function assertFileNotOpen(directory: string, path: string) {
  const target = (await resolveWorkspacePath(directory, relative(directory, resolve(directory, path)), true)).path;
  for (const { state } of listConnections()) {
    if (state.directory !== directory) continue;
    const document = state.document as { selection?: { filePath?: string; canvasPath?: string } } | undefined;
    const openPaths = [state.canvasId, document?.selection?.filePath, document?.selection?.canvasPath];
    for (const file of openPaths) {
      if (!file) continue;
      const opened = (await resolveWorkspacePath(directory, relative(directory, resolve(directory, file)), true)).path;
      if (isWithin(target, opened)) throw new Error("文件正在 MangaFlow 中打开，请使用画布或文档工具修改，关闭后再执行文件操作");
    }
  }
}

export async function getMcpTools(): Promise<McpTool[]> {
  const authorizationSignal = authorizationController.signal;
  let pluginError: string | undefined;
  const tools: McpTool[] = [{
    name: "getAppState", description: "列出连接的 MangaFlow 页面及其 connectionId、工作目录、画布、项目列表和节点能力。多个页面时必须用 target.connectionId 明确操作对象；无页面连接时只有显式 target.directory 的服务端工具可用。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const workspaceRoot = resolve(dirname(conf.path), "workspaces");
      await mkdir(workspaceRoot, { recursive: true });
      const production = readProduction();
      return { connections: listConnections(), workspaceRoot,
        modelExecution: { agent: "external", qcMethod: production.qcMethod, qcTrigger: production.qcTrigger,
          qcLevel: production.qcLevel, videoQcModelId: production.videoQcModelId, audioQcModelId: production.audioQcModelId },
        ...(pluginError ? { pluginError } : {}) };
    },
  }];
  const taskSchema = z.strictObject({ taskId: z.uuid() });
  for (const cancel of [false, true]) {
    tools.push(wrapTool(cancel ? "cancelMcpTask" : "getMcpTask", cancel
      ? "请求停止当前工作区的后台任务。取消不保证供应商撤销算力或费用；ComfyUI 视频使用原 generationId 核对远端状态。"
      : "读取当前工作区后台任务的状态与最终结果，不调用模型、不重新执行任务。interrupted 表示远端状态未知，不得换 ID 盲目重提。",
    z.toJSONSchema(taskSchema), async (args, target) => {
      const { directory } = await resolveTarget(target);
      return getMcpTask(directory!, taskSchema.parse(args).taskId, cancel);
    }));
  }
  tools.push(wrapTool(videoTemplateSearch.name, videoTemplateSearch.description, videoTemplateSearch.parameters,
    async (args, _target, signal) => videoTemplateSearch.execute(args, signal)));
  tools.push(wrapTool("videoPrompt", "外部 Agent 直接完成 H3 提示词：prepare 获取合同、真实配置、素材版本及验收要求；可在 input.creativeSelection 传 searchVideoPromptTemplates 返回的模板 ID，prepare 返回适用的视频摘要；inspect 程序预检；submit 提交当前外部 Agent 的逐项审核证据并取得 reviewId/generationRequest。三个操作均不调用语言模型、不生成媒体、不写节点。仍需按 workflow 读取导演和 H3 技能；生成前另核对用户算力授权。",
    z.toJSONSchema(videoPromptSchema), async (args, target, signal) => {
      const { directory, connection } = await resolveTarget(target);
      const canvas: CanvasContext | undefined = connection ? { id: connection.state.canvasId ?? "mcp", tools: connection.state.tools,
        call: (request, callSignal) => callControl(connection.id, request.name, request.args, callSignal ?? signal, directory) } : undefined;
      return externalVideoPrompt(directory!, args, canvas, signal);
    }));
  for (const [name, schema] of Object.entries(uiSchemas)) {
    tools.push(wrapTool(name, uiDescriptions[name as keyof typeof uiSchemas], z.toJSONSchema(schema), async (input, target, signal) => {
      const args = schema.parse(input);
      const { connection, directory } = await resolveTarget(target, !["openProject", "getSettings", "updateSettings"].includes(name));
      if (!connection) throw new Error("请先打开 MangaFlow 桌面或网页");
      if (name === "openProject") await resolveDirectory((args as { directory: string }).directory);
      const result = await callControl(connection.id, name, args, signal, directory);
      return name === "getSettings" || name === "updateSettings" ? redactSecrets(result) : result;
    }));
  }
  const canvasStub: CanvasContext = { id: "mcp", tools: [], async call() { throw new Error("尚未绑定画布"); } };
  // ACT: 插件损坏时仍保留应用管理工具，允许读取错误并修复插件。
  const definitions = await createAgentTools(dirname(conf.path), canvasStub).catch(error => {
    pluginError = error instanceof Error ? error.message : String(error);
    return [];
  });
  for (const definition of definitions) {
    if (tools.some(tool => tool.name === definition.name)) throw new Error(t`MCP 工具名称重复：${definition.name}`);
    tools.push(wrapTool(definition.name, [definition.description, ...(definition.promptGuidelines ?? [])].join("\n"), definition.parameters, async (args, target, signal) => {
      const { connection, directory } = await resolveTarget(target);
      if (["write", "edit"].includes(definition.name) && typeof args.path === "string") await assertFileNotOpen(directory!, args.path);
      const canvas: CanvasContext | undefined = connection ? {
        id: connection.state.canvasId ?? "mcp", tools: connection.state.tools,
        call: (request, callSignal) => callControl(connection.id, request.name, request.args, callSignal ?? signal, directory),
      } : undefined;
      const current = (await createAgentTools(directory!, canvas)).find(tool => tool.name === definition.name);
      if (!current) throw new Error("工具已禁用，或所需 MangaFlow 页面未连接，请重新读取工具列表");
      // ACT: 现有插件依赖 createTools 注入的宿主能力；MCP 没有 Pi 对话，访问会话能力时明确报错。
      const context = new Proxy({ cwd: directory, mode: "rpc", hasUI: false, model: undefined, signal }, {
        get(value, key) { if (Reflect.has(value, key)) return Reflect.get(value, key); throw new Error(t`MCP 不提供内置 Agent 会话能力：${String(key)}`); },
      }) as unknown as ExtensionContext;
      return current.execute(crypto.randomUUID(), args, signal, undefined, context);
    }));
  }
  const fileSchema = z.strictObject({
    action: z.enum(["list", "mkdir", "rename", "remove", "readBinary", "writeBinary"]), path: z.string().max(4096).default(""),
    target: z.string().max(4096).optional(), recursive: z.boolean().default(false),
    base64: z.string().max(28_000_000).base64().optional(), exclusive: z.boolean().default(true),
  });
  tools.push(wrapTool("workspaceFiles", "列出、创建目录、重命名或删除工作区文件；readBinary/writeBinary通过base64传输不超过20MB的媒体，写入默认不覆盖。文本读写复用已启用的文件工具；打开中的画布或文档必须通过专门工具修改。", z.toJSONSchema(fileSchema, { io: "input" }), async (input, target, signal) => {
    const args = fileSchema.parse(input);
    const workspaceTool = (await listTools()).find(tool => tool.name === "workspace");
    if (!workspaceTool?.enabled || workspaceTool.loadError) throw new Error("工作区文件工具未启用或加载失败");
    if (!["list", "readBinary"].includes(args.action) && "readOnly" in workspaceTool.config && workspaceTool.config.readOnly === true) throw new Error("当前工作区文件工具为只读模式");
    const { directory } = await resolveTarget(target);
    const source = await resolveWorkspacePath(directory!, args.path);
    signal.throwIfAborted();
    if (args.action === "list") return (await readdir(source.path, { withFileTypes: true })).filter(item => item.isFile() || item.isDirectory()).map(item => ({ name: item.name, type: item.isDirectory() ? "directory" : "file" }));
    if (args.action === "readBinary") {
      const info = await stat(source.path);
      if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("文件必须是不超过20MB的普通文件");
      return { path: args.path, base64: (await readFile(source.path, { signal })).toString("base64") };
    }
    protectWorkspaceRoot(directory!, source.path);
    await assertFileNotOpen(directory!, args.path);
    const destination = args.action === "rename" && args.target ? await resolveWorkspacePath(directory!, args.target) : undefined;
    if (args.action === "rename" && !destination) throw new Error("重命名需要提供 args.target");
    if (destination) {
      protectWorkspaceRoot(directory!, destination.path);
      destination.path = resolve(dirname(destination.path), basename(resolve(directory!, args.target!)));
    }
    const release = lockWorkspaceFiles([source.path, ...(destination ? [destination.path] : [])]);
    try {
      if (args.action === "writeBinary") {
        if (args.base64 === undefined) throw new Error("写入二进制文件需要 base64");
        const bytes = Buffer.from(args.base64, "base64");
        if (bytes.length > 20 * 1024 * 1024) throw new Error("文件不能超过20MB");
        await writeWorkspaceFile(source.path, bytes, args.exclusive);
      } else if (args.action === "mkdir") await mkdir(source.path);
      else if (destination) await renameWorkspaceFile(source.path, destination.path);
      else if ((await lstat(source.path)).isDirectory() && !args.recursive) await rmdir(source.path);
      else await rm(source.path, { recursive: args.recursive });
    } finally { release(); }
    return { success: true };
  }));
  tools.push(wrapTool("listAppOperations", "按需查询插件、媒体供应商、素材库和 Agent 历史管理操作及其参数。先查询 schema，再调用 appOperation。", z.toJSONSchema(z.strictObject({ name: z.string().optional() })), async args => {
    return appOperations.filter(item => !args.name || item.name === args.name).map(({ name, description, parameters, path }) => {
      const schema = z.toJSONSchema(parameters);
      if (path.startsWith("/api/agent/")) {
        delete schema.properties?.directory;
        schema.required = schema.required?.filter(key => key !== "directory");
      }
      return { name, description, parameters: schema };
    });
  }));
  tools.push(wrapTool("appOperation", "执行 listAppOperations 公布的应用管理操作，parameters 必须符合对应 schema。文件与节点操作使用专门工具；安装来源、覆盖和卸载须符合用户请求。", z.toJSONSchema(z.strictObject({ name: z.string(), parameters: z.record(z.string(), z.json()) })), async (args, target, signal) => {
    const operation = appOperations.find(item => item.name === args.name);
    if (!operation) throw new Error("应用操作不存在，请查询 listAppOperations");
    const parameters = { ...args.parameters as Record<string, unknown> };
    if (operation.path.startsWith("/api/agent/")) parameters.directory = (await resolveTarget(target)).directory;
    const result = await runAppOperation(operation.name, parameters, signal);
    const refreshErrors: string[] = [];
    if (operation.refresh) {
      const name = operation.refresh.nameField ? parameters[operation.refresh.nameField] : (result as { name?: string } | null)?.name;
      for (const connection of listConnections()) {
        try { await callControl(connection.id, "refreshResources", {
          type: operation.refresh.type, name,
          ...(operation.name === "deleteMediaProvider" ? { removedProviderId: (parameters.fileName as string).slice(0, -3) } : {}),
        }, signal); }
        catch (error) { refreshErrors.push(error instanceof Error ? error.message : String(error)); }
      }
    }
    return { result: redactSecrets(result), ...(refreshErrors.length ? { refreshErrors } : {}) };
  }));
  const runAgentSchema = z.strictObject({
    delegationConfirmed: z.literal(true).describe("仅当用户明确要求委托内置 Agent 并知晓额外模型消耗时填写 true；普通写作审核由当前外部 Agent 完成"),
    prompt: z.string().trim().min(1), providerId: z.string().min(1), modelId: z.string().min(1),
    sessionFile: z.string().regex(/^[\w-]+\.jsonl$/).optional(), thinkingLevel: z.string().trim().min(1).max(64).optional(),
  });
  tools.push(wrapTool("runAgent", "仅按用户明确委托启动 MangaFlow 内置 Agent，会额外调用指定语言模型。普通写作、规划、提示词、审核和报告由当前外部 Agent 直接完成，不调用此工具。后台结果包含对话文件与回复，历史保存到工作区；查询和请求停止分别使用 getMcpTask/cancelMcpTask。", z.toJSONSchema(runAgentSchema), async (input, target, signal) => {
    const { delegationConfirmed: _delegationConfirmed, ...args } = runAgentSchema.parse(input);
    const { directory, connection } = await resolveTarget(target);
    const canvas: CanvasContext | undefined = connection ? {
      id: connection.state.canvasId ?? "mcp", tools: connection.state.tools,
      call: (request, callSignal) => callControl(connection.id, request.name, request.args, callSignal ?? signal, directory),
    } : undefined;
    const blocks = new Map<string, string>();
    let sessionFile = args.sessionFile;
    await runAgent({ ...args, cwd: directory!, canvas, signal }, event => {
      if (event.type === "session") sessionFile = event.file;
      if (event.type === "text") blocks.set(event.blockId, event.content ?? (blocks.get(event.blockId) ?? "") + (event.delta ?? ""));
    });
    return { sessionFile, text: [...blocks.values()].join("\n") };
  }));
  return tools.map(tool => ({
    ...tool,
    execute(input, signal) {
      const requestSignal = AbortSignal.any([signal, authorizationSignal]);
      requestSignal.throwIfAborted();
      return tool.execute(input, requestSignal);
    },
  }));
}
