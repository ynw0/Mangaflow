import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Rule } from "@form-create/element-ui";
import type { FfmpegFactory } from "@toonflow/ffmpeg/types";
import type { Stats } from "@toonflow/file";
import { z } from "zod";

export type { ToolDefinition } from "@earendil-works/pi-coding-agent";
export type { FfmpegFactory, FfmpegCommand, FfprobeData } from "@toonflow/ffmpeg/types";

export const toolNameSchema = z.string().max(96).regex(/^[a-z][a-zA-Z0-9]*$/);
export const toolMetadataSchema = z.object({
  name: toolNameSchema,
  version: z.string().trim().min(1).max(100).default(""),
  displayName: z.string().trim().min(1).max(100),
  description: z.string().max(2000),
  prompt: z.string().max(20000).default(""),
  readme: z.string().max(200000).default(""),
  components: z.array(z.string().max(96).regex(/^[a-z][a-zA-Z0-9_]*$/)).max(100)
    .refine(names => new Set(names).size === names.length, "工具组件名称不能重复").default([]),
  author: z.string().max(100),
  github: z.string().refine(value => !value || (URL.canParse(value) && new URL(value).origin === "https://github.com" && !new URL(value).username && !new URL(value).password)),
  configRules: z.array(z.record(z.string(), z.json())).max(100),
});

export interface ToolMetadata {
  name: string;
  version?: string;
  displayName: string;
  description: string;
  prompt?: string;
  readme?: string;
  components?: string[];
  author: string;
  github: string;
  configRules: Rule[];
}

export interface NodeToolInfo {
  nodeId: string;
  name: `node:${string}`;
  nodeLabel?: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NodeToolCall {
  nodeId: string;
  name: `node:${string}`;
  args: Record<string, unknown>;
}

export interface NodeToolsContext {
  readonly tools: NodeToolInfo[];
  readonly version: number;
  list(nodeIds: string[], names?: string[]): IterableIterator<NodeToolInfo>;
  call(request: NodeToolCall, signal?: AbortSignal): Promise<unknown>;
}

export interface CanvasToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface CanvasInfo {
  id: string;
  tools: NodeToolInfo[];
}

export interface CanvasContext extends CanvasInfo {
  getNodeLabel?(nodeId: string): string | undefined;
  call(request: CanvasToolCall, signal?: AbortSignal): Promise<unknown>;
}

export interface MediaModel {
  supportsPrice?: boolean;
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
  type: "image" | "video" | "audio";
  mode?: unknown;
  usage?: string;
  imageReferences?: { min: number; max: number };
  promptFormat?: "h3Ref2va" | "h3Frames";
  supportsSeed?: boolean;
  /** 二采工作流允许单独保存一采 MP4，默认关闭。 */
  supportsFirstPassOutput?: boolean;
  /** 二采工作流可选择 LoRA 或完全关闭；defaultName 来自当前工作流。 */
  lora?: { defaultName: string };
  references?: { image: number; video: number; audio: number };
  imageSizes?: string[];
  imageRatios?: string[];
  durationResolutionMap?: { duration: number[]; resolution: string[] }[];
  /** 二采：节点 8 的百万像素档，以及节点 151 的放大倍率。有步数字段时还可改一采、二采步数。有此字段时界面不使用分辨率。 */
  sampling?: {
    megapixels: number[];
    multiple: number;
    upscaleMin: number;
    upscaleMax: number;
    upscaleStep: number;
    upscaleDefault: number;
    firstPassMin?: number;
    firstPassMax?: number;
    firstPassDefault?: number;
    secondPassMin?: number;
    secondPassMax?: number;
    secondPassDefault?: number;
  };
  audio?: boolean | "optional";
  voices?: { title: string; voice: string }[];
}

export interface MediaReference {
  path: string;
  mimeType: string;
}

export interface MediaGenerationRequest {
  providerId: string;
  modelId: string;
  prompt: string;
  outputDirectory?: string;
  images?: MediaReference[];
  videos?: MediaReference[];
  audios?: MediaReference[];
  firstFrame?: MediaReference;
  lastFrame?: MediaReference;
  ratio?: string;
  size?: string;
  resolution?: string;
  duration?: number;
  /** ComfyUI 工作流种子；云视频可忽略 */
  seed?: number;
  /** H3 服务端审核记录索引，不能代替服务端校验 */
  reviewId?: string;
  /** 同一次 ComfyUI 视频任务的唯一 ID。重连必须沿用原始参数与 ID。 */
  generationId?: string;
  /** 固定上次随机使用 seed 中的具体值 */
  seedMode?: "fixed" | "random" | "last";
  /** 二采节点 8 的百万像素；云视频可忽略 */
  megapixels?: number;
  /** 二采节点 151 的放大倍率；云视频可忽略 */
  upscale?: number;
  /** 二采节点 150 的一采步数；云视频可忽略 */
  firstPassSteps?: number;
  /** 二采节点 148 的二采步数；总步数由工作流 a+b 计算。云视频可忽略 */
  secondPassSteps?: number;
  /** 只决定是否额外保存一采视频，不跳过或改变一采采样。 */
  outputFirstPass?: boolean;
  /** 省略沿用工作流默认 LoRA；空字符串完全旁路；非空为 ComfyUI 已安装的 LoRA 名称。 */
  loraName?: string;
  generateAudio?: boolean;
  voice?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  language?: string;
  format?: string;
  sampleRate?: number;
  mode?: "singleImage" | "startEndRequired" | "endFrameOptional" | "startFrameOptional" | "text"
    | (`${"image" | "video" | "audio"}Reference:${number}`)[];
}

export interface GeneratedMedia {
  path: string;
  mimeType: string;
  mediaType: "image" | "video" | "audio";
}

/** 成片质检入参。模型与档位由设置决定，调用方只提供工作区视频。 */
export interface QcVideoRequest {
  videoPath: string;
  checklist?: string;
}

export type QcCheck = {
  requirementId?: string;
  requirement?: string;
  domain: "video" | "audio" | "general";
  result: "pass" | "fail" | "unverified";
  evidence: string;
  time?: string;
};

export type QcRequirement = { id: string; source: string; text: string };

export interface AgentVideoQcEvidence {
  revision: string;
  frames: { path: string; time: number; digest: string }[];
  requirements: QcRequirement[];
  technical: NonNullable<QcVideoResult["technical"]>;
  timelineCoverage: boolean;
  audioExpected: boolean;
}

export interface QcVideoResult {
  assessments?: { agent?: Pick<QcVideoResult, "status" | "checks" | "findings">; model?: Pick<QcVideoResult, "status" | "checks" | "findings"> };
  /** 本次 Gemma 工作流实际提交的输出 Token 预算 */
  maxOutputTokens?: number;
  status: "ok" | "rejected" | "unverified";
  checks: QcCheck[];
  technical?: { width?: number; height?: number; duration?: number; fps?: number; frameCount?: number; hasAudio: boolean };
  findings: { domain: "video" | "audio" | "general"; text: string }[];
  videoModelId: string;
  audioModelId: string;
  merged: boolean;
}

export type VideoQcState =
  | { status: "notRequested" | "queued" | "running" | "interrupted" }
  | { status: "failed"; message: string }
  | { status: "awaitingAgent"; agent: AgentVideoQcEvidence; modelResult?: QcVideoResult; modelError?: string }
  | { status: "completed"; result: QcVideoResult };

export type VideoExecution = {
  promptId: string; host: string; seed?: number; megapixels?: number; upscale?: number;
  firstPassSteps?: number; secondPassSteps?: number;
};

export type VideoQcReport = VideoQcState & {
  agentResult?: QcVideoResult;
  generation?: { providerId: string; modelId: string; reviewId?: string; duration?: number; ratio?: string; execution?: VideoExecution };
};

export type VideoQcActionResult = QcVideoResult | Extract<VideoQcState, { status: "awaitingAgent" }>;
export interface AgentVideoQcSubmission { videoPath: string; revision: string; checks: QcCheck[]; }

export interface MediaContext {
  listModels(): Promise<MediaModel[]>;
  generateImage(request: MediaGenerationRequest, signal?: AbortSignal): Promise<GeneratedMedia[]>;
  generateVideo(request: MediaGenerationRequest, signal?: AbortSignal): Promise<GeneratedMedia[]>;
  generateAudio(request: MediaGenerationRequest, signal?: AbortSignal): Promise<GeneratedMedia[]>;
  /** 按设置里的质检模型和档位验收一条工作区视频。 */
  qcVideo(request: QcVideoRequest, signal?: AbortSignal): Promise<VideoQcActionResult>;
  getVideoQcStatus(videoPath: string): Promise<VideoQcReport>;
  getAgentVideoQcEvidence(videoPath: string): Promise<{ evidence: AgentVideoQcEvidence; images: { data: string; mimeType: string }[] }>;
  submitAgentVideoQc(request: AgentVideoQcSubmission): Promise<VideoQcReport>;
}

export interface QuestionField {
  field: string;
  title: string;
  type: "input" | "textarea" | "radio" | "checkbox" | "select" | "inputNumber" | "switch";
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface QuestionRequest {
  title: string;
  question: string;
  options?: string[];
  fields?: QuestionField[];
}

export interface QuestionAnswer {
  answer: string;
  values?: Record<string, string | number | boolean | string[]>;
  skipped?: boolean;
}

export type ToolCall = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "success" | "error" | "interrupted";
  result?: string;
  question?: QuestionRequest & { callId: string };
};

export interface QuestionContext {
  ask(toolCallId: string, request: QuestionRequest, signal?: AbortSignal): Promise<QuestionAnswer>;
}

export type SkillScope = "workspace" | "global";
export type SkillLocation = { name: string; scope?: SkillScope; path?: string };
export type SkillDocument = { name: string; scope: SkillScope; path: string; content: string };

export interface SkillContext {
  list(scope?: SkillScope): { name: string; description: string; scope: SkillScope; filePath: string; disableModelInvocation: boolean }[];
  read(request: SkillLocation, signal?: AbortSignal): Promise<SkillDocument>;
  create(request: SkillLocation & { content: string }, signal?: AbortSignal): Promise<Omit<SkillDocument, "content">>;
  update(request: SkillLocation & { content: string }, signal?: AbortSignal): Promise<Omit<SkillDocument, "content">>;
}

export interface ToolFiles {
  readFile(path: string, readOnly?: boolean): Promise<Buffer>;
  access(path: string, readOnly?: boolean): Promise<void>;
  stat(path: string, readOnly?: boolean): Promise<Stats>;
  readdir(path: string, readOnly?: boolean): Promise<string[]>;
  detectImageMimeType(path: string, readOnly?: boolean): Promise<string | null>;
  writeFile(path: string, content: string | Uint8Array, exclusive?: boolean): Promise<void>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
  rename(path: string, target: string): Promise<void>;
  remove(path: string, recursive?: boolean): Promise<void>;
  copyFile(path: string, target: string, exclusive?: boolean): Promise<void>;
  importImage(url: string): Promise<{ path: string; mimeType: string }>;
}

export interface ToolContext {
  assets?: { execute: ToolDefinition["execute"] };
  browser?: {
    execute(sessionId: string, args: Record<string, unknown>, config: Record<string, unknown>, signal?: AbortSignal,
      onUpdate?: Parameters<ToolDefinition["execute"]>[3]): ReturnType<ToolDefinition["execute"]>;
  };
  ffmpeg(signal?: AbortSignal): Promise<FfmpegFactory>;
  media?: MediaContext;
  canvas?: CanvasContext;
  question?: QuestionContext;
  skills?: SkillContext;
  cwd: string;
  config: Record<string, unknown>;
  files: ToolFiles;
  resolvePath(path: string, readOnly?: boolean): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  sdk: Pick<typeof import("@earendil-works/pi-coding-agent"),
    "defineTool" | "createReadToolDefinition" | "createWriteToolDefinition" |
    "createEditToolDefinition" | "createLsToolDefinition" | "detectSupportedImageMimeTypeFromFile">;
}

export interface ToolPlugin {
  validateConfig(config: Record<string, unknown>): Record<string, unknown>;
  createTools(context: ToolContext): ToolDefinition[] | Promise<ToolDefinition[]>;
}
