import { directMediaToolNames } from "@/agent/runtime/canvasMediaRouting";
import type { PublicMcpPermissions } from "@/types/mcpPermissions";
type Permission = keyof PublicMcpPermissions;

const coreRules: Record<string, Permission> = {
  openProject: "workspaceWrite", switchPanel: "workspaceWrite", openDocument: "workspaceWrite",
  getDocument: "workspaceRead", writeDocument: "workspaceWrite", videoPrompt: "workspaceWrite",
  getSettings: "appManagement", updateSettings: "appManagement",
  listAppOperations: "appManagement", appOperation: "appManagement", runAgent: "agentExecution",
};
const canvasRules: Record<string, Permission> = {
  getCanvas: "workspaceRead", findCanvasNodes: "workspaceRead", getCanvasNodes: "workspaceRead",
  getCanvasEdges: "workspaceRead", getNodeTools: "workspaceRead",
  addCanvas: "workspaceWrite", switchCanvas: "workspaceWrite", renameCanvas: "workspaceWrite",
  addNode: "workspaceWrite", moveNodes: "workspaceWrite", renameNodes: "workspaceWrite", connectNodes: "workspaceWrite",
  selectNodes: "workspaceWrite", arrangeCanvas: "workspaceWrite", fitCanvas: "workspaceWrite",
  deleteNodes: "workspaceDelete", deleteEdges: "workspaceDelete",
};
const nodeRules: Record<string, Permission> = {
  "node:getConfig": "workspaceRead", "node:getPromptContext": "workspaceRead",
  "node:getGenerationStatus": "mediaGeneration", "node:getPersistentGenerationStatus": "mediaGeneration",
  "node:setConfig": "workspaceWrite", "node:setPrompt": "workspaceWrite", "node:setText": "workspaceWrite",
  "node:setImage": "workspaceWrite", "node:setVideo": "workspaceWrite", "node:setAudio": "workspaceWrite",
  "node:generateImage": "mediaGeneration", "node:generateVideo": "mediaGeneration", "node:generateAudio": "mediaGeneration",
  "node:cancelGeneration": "mediaGeneration", "node:cancelPersistentGeneration": "mediaGeneration",
};
const workspaceRules: Record<string, Permission> = {
  read: "workspaceRead", ls: "workspaceRead", write: "workspaceWrite", edit: "workspaceWrite", downloadImage: "workspaceWrite",
};
const fileRules: Record<string, Permission> = {
  list: "workspaceRead", readBinary: "workspaceRead", writeBinary: "workspaceWrite",
  mkdir: "workspaceWrite", rename: "workspaceWrite", remove: "workspaceDelete",
};
const mediaRules: Record<string, Permission> = {
  generateImage: "mediaGeneration", generateVideo: "mediaGeneration", generateAudio: "mediaGeneration",
  qcVideo: "mediaGeneration", getVideoQcStatus: "workspaceRead", getVideoQcFrames: "workspaceRead",
  submitVideoQc: "workspaceWrite", saveVideoQcRectificationPlan: "workspaceWrite",
};

function hasPermission(permissions: PublicMcpPermissions, permission: Permission | undefined) {
  return permission !== undefined && permissions[permission] === true;
}

export function canUseMcpTool(name: string, plugin: string | undefined, permissions: PublicMcpPermissions | null, allowDirectMedia: boolean, args?: Record<string, unknown>) {
  if (!allowDirectMedia && directMediaToolNames.some(tool => tool === name)) return false;
  if (!permissions) return true;
  if (!plugin) {
    if (name === "getAppState" || name === "searchVideoPromptTemplates") return true;
    if (name === "getMcpTask" || name === "cancelMcpTask") return Boolean(permissions.mediaGeneration || permissions.agentExecution);
    if (name === "workspaceFiles") return args
      ? hasPermission(permissions, typeof args.action === "string" ? fileRules[args.action] : undefined)
      : Boolean(permissions.workspaceRead || permissions.workspaceWrite || permissions.workspaceDelete);
    return hasPermission(permissions, coreRules[name]);
  }
  if (plugin === "canvas") {
    if (name === "nodeTools") return args
      ? hasPermission(permissions, typeof args.name === "string" ? nodeRules[args.name] ?? "pluginExecution" : undefined)
      : Boolean(permissions.workspaceRead || permissions.workspaceWrite || permissions.mediaGeneration || permissions.pluginExecution);
    return hasPermission(permissions, canvasRules[name]);
  }
  if (plugin === "workspace") return hasPermission(permissions, workspaceRules[name]);
  if (plugin === "mediaGeneration") {
    if (name === "listMediaModels") return Boolean(permissions.workspaceRead || permissions.mediaGeneration);
    return hasPermission(permissions, mediaRules[name]);
  }
  if (plugin === "skillOperator" && name === "skillOperator") {
    if (!args) return Boolean(permissions.workspaceRead || permissions.workspaceWrite || permissions.appManagement);
    if (args.action === "list" || args.action === "read") return Boolean(permissions.workspaceRead);
    return Boolean(args.scope === "workspace" ? permissions.workspaceWrite : permissions.appManagement);
  }
  return Boolean(permissions.pluginExecution);
}
