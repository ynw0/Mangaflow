import { t } from "@/lib/i18n";
import { listMediaModels, generateMedia } from "@/utils/media/generation";
import { checkRecordedVideo, getVideoQcStatus, getAgentVideoQcEvidence, submitAgentVideoQc, saveVideoQcRectificationPlan } from "@/utils/production/videoRecords";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { createBrowserContext } from "@/utils/browser";
import { importImage } from "@/utils/workspace/chatImages";
import { basename, dirname, join, relative, resolve } from "node:path";
import { access, constants, copyFile, lstat, mkdir, readFile, readdir, rm, rmdir, stat, withFileAccess } from "@toonflow/file";
import {
  defineTool, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
  detectSupportedImageMimeTypeFromFile, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { CanvasContext, QuestionContext, ToolContext, ToolFiles } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { isWithin, resolveWorkspacePath, writeWorkspaceFile, renameWorkspaceFile, lockWorkspaceFiles, protectWorkspaceRoot } from "@/utils/workspace/files";
import { attemptBoundary, createBoundaryGrants, recoverOutsidePath, runWithBoundary } from "@/utils/workspace/boundary";
import type { BoundaryAction } from "@/utils/workspace/boundary";
import { listTools, loadTool, validateToolConfig } from "@/utils/plugins/tools";
import { createSkillContext } from "@/agent/skills";
import { createAssetContext } from "@/agent/assets";
import { readDocument } from "@/utils/documents";

export function createAgentToolContext(cwd: string, config: Record<string, unknown> = {}, canvas?: CanvasContext, question?: QuestionContext, workspaceAvailable = true): ToolContext {
  const skillsDirectory = join(dirname(conf.path), "skills");
  const requireWorkspace = () => { if (!workspaceAvailable) throw new Error("此对话未提供工作目录，无法使用文件或媒体操作"); };
  const resolvePath = async (path: string, readOnly = false, action: BoundaryAction = "read") => {
    requireWorkspace();
    const absolute = resolve(cwd, path);
    const root = readOnly && isWithin(skillsDirectory, absolute) ? skillsDirectory : cwd;
    try {
      return (await resolveWorkspacePath(root, relative(root, absolute), true)).path;
    } catch (error) {
      return recoverOutsidePath(root, absolute, action, error);
    }
  };
  const withWritePaths = async (items: { path: string; action: BoundaryAction }[], operation: (targets: string[]) => Promise<void>) => {
    const targets = await Promise.all(items.map(item => resolvePath(item.path, false, item.action)));
    const release = lockWorkspaceFiles(targets);
    try { await operation(targets); }
    finally { release(); }
  };
  const files: ToolFiles = {
    importImage: url => { requireWorkspace(); return importImage(cwd, url); },
    readFile: async (path, readOnly = false) => readFile(await resolvePath(path, readOnly, "read")),
    access: async (path, readOnly = false) => access(await resolvePath(path, readOnly, "read")),
    stat: async (path, readOnly = false) => stat(await resolvePath(path, readOnly, "read")),
    readdir: async (path, readOnly = false) => readdir(await resolvePath(path, readOnly, "read")),
    detectImageMimeType: async (path, readOnly = false) => {
      const target = await resolvePath(path, readOnly, "read");
      return withFileAccess([target], "read", () => detectSupportedImageMimeTypeFromFile(target));
    },
    writeFile: (path, content, exclusive = false) => withWritePaths([{ path, action: "write" }], async ([target]) => {
      await writeWorkspaceFile(target, content, exclusive);
    }),
    mkdir: async (path, recursive = false) => {
      const target = await resolvePath(path, false, "write");
      // ACT: 递归创建已有目录无需修改，锁父目录会与 Agent 自己持有的会话文件锁冲突。
      if (recursive && (await stat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }))?.isDirectory()) return;
      const release = lockWorkspaceFiles([target]);
      try { await mkdir(target, { recursive }); }
      finally { release(); }
    },
    rename: (path, target) => withWritePaths([{ path, action: "delete" }, { path: target, action: "write" }], async ([source, destination]) => {
      protectWorkspaceRoot(cwd, source);
      protectWorkspaceRoot(cwd, destination);
      await renameWorkspaceFile(source, resolve(dirname(destination), basename(resolve(cwd, target))));
    }),
    remove: (path, recursive = false) => withWritePaths([{ path, action: "delete" }], async ([target]) => {
      protectWorkspaceRoot(cwd, target);
      if ((await lstat(target)).isDirectory() && !recursive) await rmdir(target);
      else await rm(target, { recursive });
    }),
    copyFile: (path, target, exclusive = false) => withWritePaths([{ path, action: "read" }, { path: target, action: "write" }], async ([source, destination]) => {
      await copyFile(source, destination, exclusive ? constants.COPYFILE_EXCL : 0);
    }),
  };
  return {
    cwd, config, files, resolvePath, writeFile: files.writeFile, canvas, question,
    skills: workspaceAvailable ? createSkillContext(cwd) : undefined, assets: workspaceAvailable ? createAssetContext(cwd) : undefined,
    browser: createBrowserContext(cwd),
    ffmpeg: signal => { requireWorkspace(); return createWorkspaceFfmpeg(cwd, signal); },
    media: workspaceAvailable ? {
      listModels: listMediaModels,
      generateImage: (request, signal) => generateMedia(cwd, "image", request, signal),
      generateVideo: (request, signal) => generateMedia(cwd, "video", request, signal),
      generateAudio: (request, signal) => generateMedia(cwd, "audio", request, signal),
      qcVideo: (request, signal) => checkRecordedVideo(cwd, request.videoPath, request.checklist, signal),
      getVideoQcStatus: videoPath => getVideoQcStatus(cwd, videoPath),
      getAgentVideoQcEvidence: videoPath => getAgentVideoQcEvidence(cwd, videoPath),
      submitAgentVideoQc: request => submitAgentVideoQc(cwd, request),
      saveVideoQcRectificationPlan: request => saveVideoQcRectificationPlan(cwd, request),
    } : undefined,
    sdk: {
      defineTool, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
      createReadToolDefinition: (directory, options) => {
        const operations = options?.operations ?? {
          readFile: (path: string) => files.readFile(path, true),
          access: (path: string) => files.access(path, true),
          detectImageMimeType: (path: string) => files.detectImageMimeType(path, true),
        };
        const tool = createReadToolDefinition(directory, { ...options, operations: {
          ...operations,
          readFile: async path => readDocument(path, await operations.readFile(path)),
        } });
        return { ...tool, description: `${tool.description}\nHTML、Markdown、JSON、XML、配置和代码文件读取原文；Office、OpenDocument、RTF、EPUB、CSV、PDF 在本地解析为 Markdown。offset/limit 对应读取后的行。扫描 PDF 需要先做 OCR。` };
      },
      detectSupportedImageMimeTypeFromFile: path => files.detectImageMimeType(path, true),
    },
  };
}

export async function createAgentTools(cwd: string, canvas?: CanvasContext, question?: QuestionContext): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  const names = new Set<string>();
  const grants = createBoundaryGrants();
  const context = createAgentToolContext(cwd, {}, canvas, question);
  for (const item of await listTools()) {
    if (!item.enabled) continue;
    if (item.loadError) throw new Error(`${item.displayName}：${item.loadError}`);
    const { plugin, metadata } = await loadTool(item.name);
    const config = validateToolConfig(plugin, item.config);
    const definitions = await plugin.createTools({ ...context, config });
    for (const tool of definitions) {
      if (!tool.name || typeof tool.execute !== "function") throw new Error(t`${item.displayName} 返回了无效的工具`);
      if (names.has(tool.name)) throw new Error(t`工具名称重复：${tool.name}`);
      names.add(tool.name);
      const execute = tool.execute;
      tools.push({
        ...tool,
        promptGuidelines: [
          ...(metadata.prompt ? [metadata.prompt] : []),
          ...(tool.promptGuidelines ?? []),
        ],
        execute: (id, params, signal, onUpdate, ctx) => runWithBoundary({
          grants,
          cwd,
          signal,
          ask: question ? request => question.ask(id, request, signal) : undefined,
        }, () => attemptBoundary(() => execute(id, params, signal, onUpdate, ctx))),
      });
    }
  }
  return tools;
}
