// 成片视听质检：按 settings.production 的视频/音频质检模型调用（默认 qwen3.8-omni-flash），不经 sidecar。
import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, rmdir } from "@toonflow/file";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";
import { getConfiguredModel, listAiModels } from "@/utils/ai";
import type { FfmpegCommand } from "@toonflow/ffmpeg/types";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { resolveComfyBaseUrl } from "@/utils/production/autodl";
import { findWorkflow } from "@/utils/production/catalog";
import { freeComfyMemory, probeComfy, readFreeVram, readNodeChoices, readNodeIntegerRange, submitWorkflow, uploadInput, waitForText } from "@/utils/production/comfyui";
import { assertGemmaModelEnabled, gemmaWorkflowId, gemmaTargetId, isGemmaQcId } from "@/utils/production/gemmaQcModels";
import { fail, isWorkflowEnabled, readProduction, type ProductionConfig } from "@/utils/production/config";
import { resolveWorkspacePath, writeWorkspaceFile, lockWorkspaceFiles } from "@/utils/workspace/files";
import { requirementsForQc, summarizeQc } from "@/utils/production/qcResult";
import type { AgentVideoQcEvidence, MediaGenerationRequest, QcRequirement, QcVideoResult } from "@toonflow/tools-scaffold/runtime";

type ModelInputs = { image: boolean; video: boolean; audio: boolean };
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

const videoBytesLimit = 32 * 1024 * 1024;

function readInputs(model: { inputs?: { image?: boolean; video?: boolean; audio?: boolean } }): ModelInputs {
  return { image: model.inputs?.image === true, video: model.inputs?.video === true, audio: model.inputs?.audio === true };
}

const defaultQcModelId = "qwen3.8-omni-flash";
function readFrameRate(stream: { avg_frame_rate?: string; r_frame_rate?: string }) {
  const rate = stream.avg_frame_rate || stream.r_frame_rate || "";
  const [num, den] = rate.split("/").map(Number);
  const fps = den ? num / den : num;
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
}

const vramShortMessage = "显存不足，需要等待视频生成工作流释放显存";

// 文件体积再留出视频帧和激活。空闲不够就等视频工作流释放，不改到 CPU。
function gemmaVramBudget(fileName: string) {
  const name = fileName.toLowerCase().replaceAll("fp16", "bf16");
  if (name.includes("12b") && name.includes("bf16")) return 28 * 1024 ** 3;
  if (name.includes("12b")) return 16 * 1024 ** 3;
  if (name.includes("e4b") && name.includes("bf16")) return 18 * 1024 ** 3;
  if (name.includes("e4b")) return 12 * 1024 ** 3;
  if (name.includes("bf16")) return 14 * 1024 ** 3;
  return 8 * 1024 ** 3;
}

function cudaDeviceMismatch(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /cuda device/i.test(message) && /\bcpu\b/i.test(message);
}

async function waitForFreeVram(baseUrl: string, needed: number, signal?: AbortSignal) {
  const deadline = Date.now() + 60 * 60_000;
  let lastRelease = 0;
  let unread = 0;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const free = await readFreeVram(baseUrl, signal);
    if (free == null) {
      unread += 1;
      if (unread >= 3) return;
    } else if (free >= needed) {
      return;
    } else if (Date.now() - lastRelease >= 15_000) {
      await freeComfyMemory(baseUrl);
      lastRelease = Date.now();
      unread = 0;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  fail(vramShortMessage, 503);
}

async function runGemmaQc(baseUrl: string, absoluteVideo: string, prompt: string, model: string, production: ProductionConfig, hearAudio: boolean, signal?: AbortSignal) {
  await probeComfy(baseUrl, signal);
  const entry = await findWorkflow(gemmaWorkflowId);
  if (!isWorkflowEnabled(entry.id)) fail(`${entry.label} 已在设置中关闭`);
  const raw = JSON.parse(await readFile(entry.workflowPath, "utf8")) as Record<string, { inputs?: Record<string, unknown> }>;
  const workflow = structuredClone(raw);
  const loader = workflow["1"]?.inputs;
  const clip = workflow["4"]?.inputs;
  const generate = workflow["5"]?.inputs;
  if (!loader || !clip || !generate) fail("质检工作流节点不完整");
  const range = await readNodeIntegerRange(baseUrl, "TextGenerate", "max_length", signal);
  const maxOutputTokens = Math.min(range.max, Math.max(range.min, 32768));
  generate.max_length = maxOutputTokens;
  const names = await readNodeChoices(baseUrl, "CLIPLoader", "clip_name", signal);
  if (!names.includes(model)) fail("当前 ComfyUI 未安装所选 Gemma 权重，请刷新模型列表。");
  await waitForFreeVram(baseUrl, gemmaVramBudget(model), signal);
  clip.device = "default";
  clip.clip_name = model;
  const assertSelection = () => {
    const current = readProduction();
    if (gemmaTargetId(current) !== gemmaTargetId(production)) fail("质检实例已变化，请重新发起质检。");
    assertGemmaModelEnabled(current, "qc/gemma4:" + model);
  };
  assertSelection();
  loader.file = await uploadInput(baseUrl, absoluteVideo, "toonflow", signal);
  generate.prompt = "按系统要求写下你实际看到和听到的内容。";
  generate.system_prompt = `${prompt}\n\n使用自然、准确的简体中文回答。`;
  if (!hearAudio) delete generate.audio;
  assertSelection();
  const promptId = await submitWorkflow(baseUrl, workflow, signal, { lockedClipNode: "4", onSubmitting: async () => assertSelection() });
  await freeComfyMemory(baseUrl);
  try {
    return { text: await waitForText(baseUrl, promptId, signal), maxOutputTokens };
  } catch (error) {
    if (cudaDeviceMismatch(error)) fail(vramShortMessage, 502);
    throw error;
  } finally {
    await freeComfyMemory(baseUrl);
  }
}

function resolveQcModel(modelId: string) {
  const id = modelId.trim() || defaultQcModelId;
  const match = listAiModels().find(item => item.modelId === id);
  if (!match) {
    fail(`质检模型未配置：请在「语言 → 语言模型」中添加 ${id}（或把设置里的质检模型改成已有模型）`);
  }
  return { configured: getConfiguredModel(match.providerId, match.modelId), modelId: match.modelId, inputs: readInputs(match) };
}

function runCommand(command: FfmpegCommand, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const cancel = () => command.kill("SIGKILL");
  signal?.addEventListener("abort", cancel, { once: true });
  return new Promise<void>((resolve, reject) => {
    command.on("start", () => { if (signal?.aborted) command.kill("SIGKILL"); });
    command.on("error", (error: unknown) => reject(signal?.aborted ? signal.reason : error));
    command.on("end", () => signal?.aborted ? reject(signal.reason) : resolve());
    command.run();
  }).finally(() => signal?.removeEventListener("abort", cancel));
}

// 抽帧用的 FFmpeg 只能读写临时目录。成片在项目目录里，先复制进来再抽。
function qcSourceName(videoPath: string) {
  const extension = extname(videoPath).toLowerCase();
  return `qcSource${crypto.randomUUID()}${/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".mp4"}`;
}

async function extractEvidence(absoluteVideo: string, workDir: string, detailed: boolean, signal?: AbortSignal, includeAudio = true) {
  const ffmpeg = await createWorkspaceFfmpeg(workDir, signal);
  const audioPath = join(workDir, "qc-audio.mp3");
  const framePaths: string[] = [];
  const frameTimes: number[] = [];

  const probe = await new Promise<{ streams?: { codec_type?: string; disposition?: { attached_pic?: number }; width?: number; height?: number; nb_frames?: string | number; avg_frame_rate?: string; r_frame_rate?: string }[]; format?: { duration?: string | number } }>((resolve, reject) => {
    const command = ffmpeg(absoluteVideo);
    const cancel = () => command.kill("SIGKILL");
    signal?.addEventListener("abort", cancel, { once: true });
    command.ffprobe((error: unknown, data: unknown) => {
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) reject(signal.reason);
      else if (error) reject(error);
      else resolve(data as { streams?: { codec_type?: string; disposition?: { attached_pic?: number }; nb_frames?: string | number; avg_frame_rate?: string; r_frame_rate?: string }[]; format?: { duration?: string | number } });
    });
  });

  const videoStream = probe.streams?.find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  if (!videoStream) fail("质检目标不是含画面的视频文件");
  const duration = Number(probe.format?.duration) || 0;
  const hasAudio = probe.streams?.some(stream => stream.codec_type === "audio") === true;

  // 镜头合同密集抽帧，普通检查限制图片数量；每一帧都保留真实时间戳。
  const usableDuration = Math.max(0, duration - 0.05);
  const count = detailed ? Math.min(21, Math.max(2, Math.ceil(duration * 2) + 1))
    : Math.min(7, Math.max(2, Math.ceil(duration / 2) + 1));
  for (let index = 0; index < count; index++) {
    const stamp = Number((usableDuration * index / (count - 1)).toFixed(3));
    const path = join(workDir, `qc-frame-${index}.jpg`);
    framePaths.push(path);
    frameTimes.push(stamp);
    const command = ffmpeg(absoluteVideo).seekInput(stamp).frames(1).output(path).outputOptions("-q:v", "3");
    await runCommand(command, signal);
  }

  let audioBytes: Buffer | undefined;
  if (hasAudio && includeAudio) {
    const command = ffmpeg(absoluteVideo).output(audioPath).noVideo().audioCodec("libmp3lame").audioBitrate(128).format("mp3")
      .outputOptions("-map", "0:a:0");
    await runCommand(command, signal);
    audioBytes = await readFile(audioPath);
    // Omni Base64 体积限制：过长则截前约 8MB
    if (audioBytes.length > 8 * 1024 * 1024) audioBytes = audioBytes.subarray(0, 8 * 1024 * 1024);
  }

  const frames = await Promise.all(framePaths.map(async path => {
    const bytes = await readFile(path);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  }));

  const fps = readFrameRate(videoStream);
  const frameCount = Number(videoStream.nb_frames) || undefined;
  const technical = { width: videoStream.width, height: videoStream.height, duration: duration || undefined, fps, frameCount, hasAudio };
  // 密度足够才允许时间序列验收；无法观察的帧间事件仍必须标 unverified。
  const timelineCoverage = detailed && duration > 0 && frameTimes.length > 1
    && frameTimes.every((stamp, index) => index === 0 || stamp - frameTimes[index - 1]! <= 0.55);
  return { frames, frameTimes, timelineCoverage, audioBase64: audioBytes ? audioBytes.toString("base64") : undefined, technical };
}

function evidenceFolder(revision: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(revision)) throw new Error("抽帧版本无效");
  return `assets/qcEvidence/evidence${revision.replaceAll("-", "")}`;
}

// 只回收本次实际生成、内容仍一致的帧，目录中另存的文件由用户保留。
export async function releaseQcFrames(directory: string, evidence: AgentVideoQcEvidence) {
  try {
    const folder = evidenceFolder(evidence.revision);
    const target = await resolveWorkspacePath(directory, folder);
    const release = lockWorkspaceFiles([target.path]);
    try {
      for (const [index, frame] of evidence.frames.entries()) {
        if (frame.path !== `${folder}/frame${index}.jpg`) throw new Error("质检帧路径与版本不符");
        try {
          const file = await resolveWorkspacePath(directory, frame.path);
          const bytes = await readFile(file.path);
          if (createHash("sha256").update(bytes).digest("hex") === frame.digest) await unlink(file.path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      await rmdir(target.path);
    } finally {
      release();
    }
  } catch (error) {
    // 清理失败要可追踪，已保存的验收结论仍然有效。
    if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      console.warn("清理质检抽帧失败", evidence.revision, error);
    }
  }
}

export async function prepareAgentVideoQc(directory: string, videoPath: string, requirements: QcRequirement[], audioExpected: boolean, includeAudio: boolean, signal?: AbortSignal) {
  const video = await resolveWorkspacePath(directory, videoPath);
  const output = await resolveWorkspacePath(directory, "assets/qcEvidence", true);
  const revision = crypto.randomUUID();
  const relativeDirectory = evidenceFolder(revision);
  const release = lockWorkspaceFiles([join(output.path, basename(relativeDirectory))]);
  let workDir: string | undefined;
  const written: string[] = [];
  let evidenceDirectory: string | undefined;
  try {
    workDir = await mkdtemp(join(tmpdir(), "mangaflowQc"));
    const localVideo = join(workDir, qcSourceName(video.path));
    await copyFile(video.path, localVideo);
    const raw = await extractEvidence(localVideo, workDir, true, signal, includeAudio);
    await mkdir(output.path, { recursive: true });
    const folder = (await resolveWorkspacePath(directory, relativeDirectory)).path;
    await mkdir(folder);
    evidenceDirectory = folder;
    const frames: AgentVideoQcEvidence["frames"] = [];
    for (const [index, frame] of raw.frames.entries()) {
      signal?.throwIfAborted();
      const path = `${relativeDirectory}/frame${index}.jpg`;
      const target = (await resolveWorkspacePath(directory, path)).path;
      const bytes = Buffer.from(frame.slice(frame.indexOf(",") + 1), "base64");
      await writeWorkspaceFile(target, bytes, true);
      written.push(target);
      frames.push({ path, time: raw.frameTimes[index]!, digest: createHash("sha256").update(bytes).digest("hex") });
    }
    return { raw, agent: { revision, frames, requirements: requirementsForQc(requirements, "video"), technical: raw.technical, timelineCoverage: raw.timelineCoverage, audioExpected } satisfies AgentVideoQcEvidence };
  } catch (error) {
    await Promise.all(written.map(path => unlink(path)));
    if (evidenceDirectory) await rmdir(evidenceDirectory);
    throw error;
  } finally {
    release();
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(error => console.warn("清理质检临时目录失败", workDir, error));
  }
}

async function completeMultimodal(configured: ReturnType<typeof getConfiguredModel>, parts: ContentPart[], signal?: AbortSignal) {
  const url = `${configured.baseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${configured.provider.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: configured.model.id,
      messages: [{ role: "user", content: parts }],
      modalities: ["text"],
      stream: true,
      stream_options: { include_usage: true },
      enable_thinking: false,
    }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    fail(`质检模型调用失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 400)}` : ""}`);
  }
  const reader = response.body?.getReader();
  if (!reader) fail("质检模型返回空响应流");
  const decoder = new TextDecoder();
  let text = "";
  let buffer = "";
  while (true) {
    signal?.throwIfAborted();
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: { delta?: { content?: unknown; reasoning_content?: unknown } }[];
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string") text += delta;
        else if (Array.isArray(delta)) {
          for (const part of delta) {
            if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
              text += (part as { text: string }).text;
            }
          }
        }
      } catch {
        // 忽略非整段 JSON 的 keep-alive
      }
    }
  }
  text = text.trim();
  if (!text) fail("质检模型未返回文本");
  return text;
}

function videoMime(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "video/mp4";
}

async function visualParts(absoluteVideo: string, inputs: ModelInputs, frames: string[], frameTimes: number[]): Promise<ContentPart[]> {
  if (inputs.image) return frames.flatMap((url, index): ContentPart[] => [
    { type: "text", text: `第 ${index + 1}/${frames.length} 帧，视频时间 ${frameTimes[index]?.toFixed(3) ?? "?"} 秒（这是离散帧证据）` },
    { type: "image_url", image_url: { url } },
  ]);
  const bytes = await readFile(absoluteVideo);
  if (bytes.length > videoBytesLimit) {
    fail("成片超过 32MB，当前质检模型只接受整段视频。请改用勾选了图像输入的模型，或缩短成片。");
  }
  return [{ type: "video_url", video_url: { url: `data:${videoMime(absoluteVideo)};base64,${bytes.toString("base64")}` } }];
}

function gemmaViewerPrompt(generation: MediaGenerationRequest | undefined, requirements: QcRequirement[], hearAudio: boolean, hasAudio: boolean) {
  const lines = [
    "你是在看这条成片的观众。用平常话说你实际看到和听到的内容。怎么组织都可以，不要写成指定字段或 JSON。",
    "写下这些：画面和声音是否正常；观感是否自然，有没有发僵或 AI 感；画面是否正确；动作和表情哪里不对；有没有明显毛病；哪里看了不舒服。",
    "再对照下面的剧本和生成提示词：成片和它们差在哪里；台词有没有说完；说出来的话有没有说错。听不清或看不见就直接写听不清、看不见，不要编。",
  ];
  if (requirements.length) lines.push("剧本和已确认的内容：", requirements.map(item => `${item.id} ${item.text}`).join("\n"));
  const prompt = generation?.prompt?.trim();
  if (prompt) lines.push("生成提示词：", prompt);
  const dialogue = generation?.qcContract?.lockedDialogue?.map(line => line.trim()).filter(Boolean);
  if (dialogue?.length) lines.push("应当说出的台词：", dialogue.join("\n"));
  if (!hearAudio) lines.push("这次没有把音轨交给你。声音和台词写明无法从音轨确认。");
  else if (!hasAudio) lines.push("这条成片没有音轨。声音和台词写明无法听辨。");
  return lines.join("\n\n");
}

function viewerAsk(generation: MediaGenerationRequest | undefined, requirements: QcRequirement[], hearAudio: boolean, hasAudio: boolean, checklist?: string) {
  return [
    gemmaViewerPrompt(generation, requirements, hearAudio, hasAudio),
    checklist?.trim() ? `本镜还要留意：\n${checklist.trim()}` : "",
  ].filter(Boolean).join("\n\n");
}

function viewerQcResult(text: string, fields: Pick<QcVideoResult, "technical" | "maxOutputTokens" | "videoModelId" | "audioModelId" | "merged">): QcVideoResult {
  const notes = text.trim();
  if (!notes) fail("质检模型未返回文本");
  return { status: "unverified", checks: [], findings: [], issues: [], notes, ...fields };
}

export async function runProductionQc(input: {
  directory: string;
  videoPath: string;
  checklist?: string;
  production?: ProductionConfig;
  generation?: MediaGenerationRequest;
  requirements?: QcRequirement[];
  onRawOutput?: (text: string) => void;
  evidence?: Awaited<ReturnType<typeof extractEvidence>>;
  signal?: AbortSignal;
}): Promise<QcVideoResult> {
  const production = input.production ?? readProduction();
  const remember = (text: string) => { input.onRawOutput?.(text); return text; };
  const videoModelId = production.videoQcModelId || defaultQcModelId;
  const audioModelId = production.audioQcModelId || defaultQcModelId;
  if (production.qcLevel === "none") {
    return {
      ...summarizeQc([{ domain: "general", result: "unverified", evidence: "当前是人工质检，没有调用质检模型。" }]),
      videoModelId: "",
      audioModelId: "",
      merged: false,
    };
  }
  const { path: absoluteVideo } = await resolveWorkspacePath(input.directory, input.videoPath);
  const workDir = await mkdtemp(join(tmpdir(), "mangaflow-qc-"));
  try {
    const videoVariant = isGemmaQcId(videoModelId);
    const audioVariant = production.qcLevel === "video" ? false : isGemmaQcId(audioModelId);
    // 音轨选了 Gemma 时，由这一条同时看画面和听对白。两条都是 Gemma 时用画面那一条。
    const gemmaVariant = videoVariant || audioVariant;
    const localVideo = join(workDir, qcSourceName(absoluteVideo));
    await copyFile(absoluteVideo, localVideo);
    const evidence = input.evidence ?? await extractEvidence(localVideo, workDir, Boolean(input.requirements?.length) && !gemmaVariant, input.signal);
    const { technical } = evidence;
    if (gemmaVariant) {
      const hearAudio = production.qcLevel !== "video";
      const usedId = (videoVariant ? videoModelId : audioModelId).trim();
      const modelFile = assertGemmaModelEnabled(production, usedId);
      if (gemmaTargetId(readProduction()) !== gemmaTargetId(production)) fail("质检实例已变化，请重新发起质检。");
      const asked = viewerAsk(input.generation, input.requirements ?? [], hearAudio, technical.hasAudio, input.checklist);
      // 固定本次质检选定的运行位置，生成和质检各自选择 ComfyUI。
      const baseUrl = await resolveComfyBaseUrl(input.signal, production.gemmaQcHost, true, production);
      const { text, maxOutputTokens } = await runGemmaQc(baseUrl, localVideo, asked, modelFile, production, hearAudio, input.signal);
      return viewerQcResult(remember(text), {
        technical, maxOutputTokens, videoModelId: usedId, audioModelId: hearAudio ? usedId : "", merged: hearAudio,
      });
    }
    if (production.qcLevel === "video") {
      const videoResolved = resolveQcModel(videoModelId);
      if (!videoResolved.inputs.image && !videoResolved.inputs.video) {
        fail(`画面质检模型 ${videoResolved.modelId} 未勾选图像或视频输入。请到「语言 → 语言模型」编辑该模型。`);
      }
      const videoText = await completeMultimodal(videoResolved.configured, [
        { type: "text", text: viewerAsk(input.generation, input.requirements ?? [], false, false, input.checklist) },
        ...await visualParts(localVideo, videoResolved.inputs, evidence.frames, evidence.frameTimes),
      ], input.signal);
      return viewerQcResult(remember(videoText), {
        technical, videoModelId: videoResolved.modelId, audioModelId: "", merged: false,
      });
    }
    const audioResolved = resolveQcModel(audioModelId);
    if (!audioResolved.inputs.audio) {
      fail(`音轨质检模型 ${audioResolved.modelId} 未勾选音频输入。请到「语言 → 语言模型」编辑该模型。`);
    }
    const videoResolved = resolveQcModel(videoModelId);
    if (!videoResolved.inputs.image && !videoResolved.inputs.video) {
      fail(`画面质检模型 ${videoResolved.modelId} 未勾选图像或视频输入。请到「语言 → 语言模型」编辑该模型。`);
    }
    const hasAudio = Boolean(evidence.audioBase64);
    const merged = videoModelId === audioModelId;

    if (merged) {
      const parts: ContentPart[] = [
        { type: "text", text: viewerAsk(input.generation, input.requirements ?? [], true, hasAudio, input.checklist) },
        ...await visualParts(localVideo, videoResolved.inputs, evidence.frames, evidence.frameTimes),
      ];
      if (evidence.audioBase64) {
        parts.push({
          type: "input_audio",
          input_audio: { data: `data:;base64,${evidence.audioBase64}`, format: "mp3" },
        });
      }
      const text = await completeMultimodal(videoResolved.configured, parts, input.signal);
      return viewerQcResult(remember(text), {
        technical, videoModelId: videoResolved.modelId, audioModelId: videoResolved.modelId, merged: true,
      });
    }

    const videoText = await completeMultimodal(videoResolved.configured, [
      { type: "text", text: viewerAsk(input.generation, input.requirements ?? [], false, false, input.checklist) },
      ...await visualParts(localVideo, videoResolved.inputs, evidence.frames, evidence.frameTimes),
    ], input.signal);
    const audioParts: ContentPart[] = [{ type: "text", text: viewerAsk(input.generation, input.requirements ?? [], true, hasAudio, input.checklist) }];
    if (evidence.audioBase64) {
      audioParts.push({
        type: "input_audio",
        input_audio: { data: `data:;base64,${evidence.audioBase64}`, format: "mp3" },
      });
    }
    const audioText = await completeMultimodal(audioResolved.configured, audioParts, input.signal);
    return viewerQcResult([remember(videoText), remember(audioText)].filter(item => item.trim()).join("\n\n"), {
      technical, videoModelId: videoResolved.modelId, audioModelId: audioResolved.modelId, merged: false,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(error => console.warn("清理质检临时目录失败", workDir, error));
  }
}
