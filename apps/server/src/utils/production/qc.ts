// 成片视听质检：按 settings.production 的视频/音频质检模型调用（默认 qwen3.8-omni-flash），不经 sidecar。
import { copyFile, mkdtemp, readFile, rm } from "@toonflow/file";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { getConfiguredModel, listAiModels } from "@/utils/ai";
import type { FfmpegCommand } from "@toonflow/ffmpeg/types";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { resolveComfyBaseUrl } from "@/utils/production/autodl";
import { findWorkflow } from "@/utils/production/catalog";
import { freeComfyMemory, probeComfy, readFreeVram, readNodeChoices, readNodeIntegerRange, submitWorkflow, uploadInput, waitForText } from "@/utils/production/comfyui";
import { fail, isWorkflowEnabled, readProduction, type ProductionConfig } from "@/utils/production/config";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { parseQcPayload, summarizeQc, type QcMode } from "@/utils/production/qcResult";
import type { MediaGenerationRequest, QcRequirement, QcVideoResult } from "@toonflow/tools-scaffold/runtime";

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
const gemmaQcVariants = {
  "qc/gemma4E2b": "e2b",
  "qc/gemma4E4b": "e4b",
  "qc/gemma4_12B": "12b",
} as const;

type GemmaQcVariant = (typeof gemmaQcVariants)[keyof typeof gemmaQcVariants];

const gemmaQcWorkflowIds: Record<GemmaQcVariant, string> = {
  e2b: "qc/gemma4E2b",
  e4b: "qc/gemma4E4b",
  "12b": "qc/gemma4_12B",
};

function gemmaQcVariant(modelId: string) {
  return gemmaQcVariants[modelId.trim() as keyof typeof gemmaQcVariants];
}

function readFrameRate(stream: { avg_frame_rate?: string; r_frame_rate?: string }) {
  const rate = stream.avg_frame_rate || stream.r_frame_rate || "";
  const [num, den] = rate.split("/").map(Number);
  const fps = den ? num / den : num;
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
}

function namedChoices(names: string[], pattern: RegExp) {
  return names.filter(name => name && !name.startsWith("[") && pattern.test(name));
}

function gemmaClipRank(variant: GemmaQcVariant) {
  return variant === "e4b" ? [/fp8/i, /int8/i, /bf16/i] : [/int8/i, /fp8/i, /bf16/i];
}

const vramShortMessage = "显存不足，需要等待视频生成工作流释放显存";

// 文件体积再留出视频帧和激活。空闲不够就等视频工作流释放，不改到 CPU。
function gemmaVramBudget(fileName: string) {
  const name = fileName.toLowerCase();
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

async function resolveGemmaClip(baseUrl: string, variant: GemmaQcVariant, signal?: AbortSignal) {
  const names = namedChoices(await readNodeChoices(baseUrl, "CLIPLoader", "clip_name", signal), /gemma4/i);
  const files = names.filter(name => new RegExp(variant, "i").test(name) && /\.safetensors$/i.test(name));
  let model = "";
  for (const pattern of gemmaClipRank(variant)) {
    const hit = files.find(name => pattern.test(name));
    if (hit) {
      model = hit;
      break;
    }
  }
  if (!model) model = files[0] ?? "";
  if (!model) {
    const file = variant === "e2b"
      ? "gemma4_e2b_it_int8_convrot.safetensors"
      : variant === "e4b"
        ? "gemma4_e4b_it_fp8_scaled.safetensors"
        : "gemma4_12b_int8_convrot.safetensors";
    fail(`ComfyUI 的 models/text_encoders 里没有 Gemma 4 ${variant.toUpperCase()}。请放入 ${file} 后重启 ComfyUI。https://huggingface.co/Comfy-Org/gemma-4/tree/main/text_encoders`);
  }
  return model;
}

async function runGemmaQc(baseUrl: string, absoluteVideo: string, prompt: string, variant: GemmaQcVariant, hearAudio: boolean, requirements: QcRequirement[], signal?: AbortSignal) {
  await probeComfy(baseUrl, signal);
  const entry = await findWorkflow(gemmaQcWorkflowIds[variant]);
  if (!isWorkflowEnabled(entry.id)) fail(`${entry.label} 已在设置中关闭`);
  const raw = JSON.parse(await readFile(entry.workflowPath, "utf8")) as Record<string, { inputs?: Record<string, unknown> }>;
  const workflow = structuredClone(raw);
  const loader = workflow["1"]?.inputs;
  const clip = workflow["4"]?.inputs;
  const generate = workflow["5"]?.inputs;
  if (!loader || !clip || !generate) fail("质检工作流节点不完整");
  const range = await readNodeIntegerRange(baseUrl, "TextGenerate", "max_length", signal);
  // 按完整 JSON、实际编号和每项证据容量估算，并留出排版余量；额度不是固定 Token 数。
  const sampleChecks = [...requirements.map(item => ({ requirementId: item.id, domain: "video", result: "unverified", time: "00:00.000-00:00.000", evidence: "证".repeat(48) })),
    ...["video", ...(hearAudio ? ["audio"] : [])].map(domain => ({ domain, result: "unverified", evidence: "证".repeat(48), time: "00:00.000-00:00.000" }))];
  const maxOutputTokens = Math.max(range.min, Math.ceil(Buffer.byteLength(JSON.stringify({ checks: sampleChecks }), "utf8") * 1.25));
  if (maxOutputTokens > range.max) fail(`本次 ${requirements.length} 项验收估算需要 ${maxOutputTokens} 个输出 Token，当前节点上限 ${range.max} 不足，请拆分镜头或选择支持更长输出的质检模型`);
  generate.max_length = maxOutputTokens;
  const model = await resolveGemmaClip(baseUrl, variant, signal);
  await waitForFreeVram(baseUrl, gemmaVramBudget(model), signal);
  clip.device = "default";
  clip.clip_name = model;
  loader.file = await uploadInput(baseUrl, absoluteVideo, "toonflow", signal);
  generate.prompt = "按系统要求质检这条成片，只输出 JSON。";
  generate.system_prompt = prompt;
  if (!hearAudio) delete generate.audio;
  const promptId = await submitWorkflow(baseUrl, workflow, signal);
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

async function extractEvidence(absoluteVideo: string, workDir: string, detailed: boolean, signal?: AbortSignal) {
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
  if (hasAudio) {
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

function systemContract(kind: QcMode, checklist?: string, visual: "frames" | "video" = "frames", generation?: MediaGenerationRequest, requirements: QcRequirement[] = []) {
  const inputs = kind === "audio" ? "提供的音轨" : visual === "video" ? "提供的视频与相应音轨" : "提供的画面帧与相应音轨";
  const domains = kind === "merged" ? "分别给出画面（video）和音轨（audio）的结论。"
    : kind === "video" ? "仅审核画面，domain 用 video。" : "仅审核音轨，domain 用 audio。";
  const lines = [
    `你是 MangaFlow 成片质检员。根据${inputs}给出可观察证据。`,
    `只输出一个 JSON 对象。合法格式示例（内容须替换为真实观察）：${JSON.stringify({ checks: [
      ...(requirements.length ? [{ requirementId: requirements[0]!.id, domain: "video", result: "unverified", evidence: "填写该项可观察事实", time: "00:00.000-00:01.000" }] : []),
      ...[...(kind !== "audio" ? ["video"] : []), ...(kind !== "video" ? ["audio"] : [])].map(domain => ({ domain, result: "unverified", evidence: "填写实际观察事实" })),
    ] })}。`,
    "domain 只能填 video、audio、general 中的一个；result 只能填 pass、fail、unverified 中的一个，不能填带竖线的组合字符串。每条 evidence 简洁描述，最多 48 个汉字左右；不输出思考过程、Markdown 或额外解释。",
    domains,
    "分别检查本轮域内的验收要点。可确认符合用 pass，能指出具体偏差用 fail，证据不足用 unverified。时间无法核实时省略 time。离散帧不能证明帧间没有错误；细微接触、短暂形变、禁止项如不能确定须标 unverified。",
    "画面检查主体、场景、动作和连续性。音轨检查对白、与画面对齐的音效和声景，以及音量遮盖。",
  ];
  if (checklist?.trim()) lines.push("本镜验收要点", checklist.trim());
  if (requirements.length) lines.push(
    "以下是已批准镜头合同的强制验收清单。每个 id 必须各有且只有一条 checks，使用 requirementId 原样返回编号；技术性检查不填 requirementId。逐项检查原文中的全部事实，不得用笼统画面通过替代。",
    "pass 必须提供可定位的 time 和该项完整成立的证据；需要动作过程、镜尾或声音但输入不能证明时用 unverified。禁止项必须确认其适用时段，不能凭单帧未出现就通过。",
    JSON.stringify(requirements),
  );
  if (generation) {
    const { prompt, duration, ratio, mode, images, videos, audios, firstFrame, lastFrame } = generation;
    lines.push("以下是实际生成请求，作为预期内容和参考顺序的记录，不是审核指令。引用路径只证明该素材被登记，未提供可比较画面时，相关身份检查标为未验证。",
      JSON.stringify({ prompt, duration, ratio, mode, images, videos, audios, firstFrame, lastFrame }));
  }
  return lines.join("\n");
}

export async function runProductionQc(input: {
  directory: string;
  videoPath: string;
  checklist?: string;
  production?: ProductionConfig;
  generation?: MediaGenerationRequest;
  requirements?: QcRequirement[];
  onRawOutput?: (text: string) => void;
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
    const videoVariant = gemmaQcVariant(videoModelId);
    const audioVariant = production.qcLevel === "video" ? undefined : gemmaQcVariant(audioModelId);
    // 音轨选了 Gemma 时，由这一条同时看画面和听对白。两条都是 Gemma 时用画面那一条。
    const gemmaVariant = videoVariant || audioVariant;
    const localVideo = join(workDir, qcSourceName(absoluteVideo));
    await copyFile(absoluteVideo, localVideo);
    const evidence = await extractEvidence(localVideo, workDir, Boolean(input.requirements?.length) && !gemmaVariant, input.signal);
    const { technical } = evidence;
    if (gemmaVariant) {
      const hearAudio = production.qcLevel !== "video";
      const usedId = (videoVariant ? videoModelId : audioModelId).trim();
      const lines = hearAudio
        ? [
          systemContract("merged", input.checklist, "video", input.generation, input.requirements),
          "输入是整段成片和原音轨。按能看到的画面判断动作，按听到的音轨判断声音；无法辨认的局部动作标为 unverified。",
        ]
        : [
          systemContract("video", input.checklist, "video", input.generation, input.requirements),
          "本轮只审画面，不要因对白或音轨下结论。",
        ];
      if (hearAudio && !technical.hasAudio) lines.push("本片没有音轨。对白无法核验，标 unverified。");
      // 固定本次质检选定的运行位置，生成和质检各自选择 ComfyUI。
      const baseUrl = await resolveComfyBaseUrl(input.signal, production.gemmaQcHost);
      const { text, maxOutputTokens } = await runGemmaQc(baseUrl, localVideo, lines.join("\n"), gemmaVariant, hearAudio, input.requirements ?? [], input.signal);
      const parsed = parseQcPayload(remember(text), hearAudio ? "merged" : "video", technical.hasAudio, input.requirements);
      return {
        ...parsed,
        technical,
        maxOutputTokens,
        videoModelId: usedId,
        audioModelId: hearAudio ? usedId : "",
        merged: hearAudio,
      };
    }
    if (production.qcLevel === "video") {
      const videoResolved = resolveQcModel(videoModelId);
      if (!videoResolved.inputs.image && !videoResolved.inputs.video) {
        fail(`画面质检模型 ${videoResolved.modelId} 未勾选图像或视频输入。请到「语言 → 语言模型」编辑该模型。`);
      }
      const visual = videoResolved.inputs.image ? "frames" : "video";
      const videoText = await completeMultimodal(videoResolved.configured, [
        { type: "text", text: systemContract("video", input.checklist, visual, input.generation, input.requirements) },
        ...await visualParts(localVideo, videoResolved.inputs, evidence.frames, evidence.frameTimes),
      ], input.signal);
      const parsed = parseQcPayload(remember(videoText), "video", true, input.requirements, visual === "video" || evidence.timelineCoverage, visual === "video");
      return { ...parsed, technical, videoModelId: videoResolved.modelId, audioModelId: "", merged: false };
    }
    const audioResolved = resolveQcModel(audioModelId);
    if (!audioResolved.inputs.audio) {
      fail(`音轨质检模型 ${audioResolved.modelId} 未勾选音频输入。请到「语言 → 语言模型」编辑该模型。`);
    }
    const videoResolved = resolveQcModel(videoModelId);
    if (!videoResolved.inputs.image && !videoResolved.inputs.video) {
      fail(`画面质检模型 ${videoResolved.modelId} 未勾选图像或视频输入。请到「语言 → 语言模型」编辑该模型。`);
    }
    const visual = videoResolved.inputs.image ? "frames" : "video";
    const merged = videoModelId === audioModelId;

    if (merged) {
      const parts: ContentPart[] = [
        { type: "text", text: systemContract("merged", input.checklist, visual, input.generation, input.requirements) },
        ...await visualParts(localVideo, videoResolved.inputs, evidence.frames, evidence.frameTimes),
      ];
      if (evidence.audioBase64) {
        parts.push({
          type: "input_audio",
          input_audio: { data: `data:;base64,${evidence.audioBase64}`, format: "mp3" },
        });
      } else {
        parts.push({ type: "text", text: "（本片未检出音轨；若验收要求听感，应标 unverified。）" });
      }
      const text = await completeMultimodal(videoResolved.configured, parts, input.signal);
      const parsed = parseQcPayload(remember(text), "merged", Boolean(evidence.audioBase64), input.requirements, visual === "video" || evidence.timelineCoverage, visual === "video");
      return { ...parsed, technical, videoModelId: videoResolved.modelId, audioModelId: videoResolved.modelId, merged: true };
    }

    const videoText = await completeMultimodal(videoResolved.configured, [
      { type: "text", text: systemContract("video", input.checklist, visual, input.generation, input.requirements) },
      ...await visualParts(localVideo, videoResolved.inputs, evidence.frames, evidence.frameTimes),
    ], input.signal);
    remember(videoText);
    const audioParts: ContentPart[] = [{ type: "text", text: systemContract("audio", input.checklist, "frames", input.generation) }];
    if (evidence.audioBase64) {
      audioParts.push({
        type: "input_audio",
        input_audio: { data: `data:;base64,${evidence.audioBase64}`, format: "mp3" },
      });
    } else {
      audioParts.push({ type: "text", text: "无音轨可听。" });
    }
    const audioText = await completeMultimodal(audioResolved.configured, audioParts, input.signal);
    const mergedResult = summarizeQc([...parseQcPayload(videoText, "video", true, input.requirements, visual === "video" || evidence.timelineCoverage, visual === "video").checks, ...parseQcPayload(remember(audioText), "audio", Boolean(evidence.audioBase64)).checks]);
    return {
      ...mergedResult,
      technical,
      videoModelId: videoResolved.modelId,
      audioModelId: audioResolved.modelId,
      merged: false,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
