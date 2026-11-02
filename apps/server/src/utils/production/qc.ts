// 成片视听质检：按 settings.production 的视频/音频质检模型调用（默认 qwen3.8-omni-flash），不经 sidecar。
import { copyFile, mkdtemp, readFile, rm } from "@toonflow/file";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { getConfiguredModel, listAiModels } from "@/utils/ai";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { findWorkflow } from "@/utils/production/catalog";
import { freeComfyMemory, probeComfy, readFreeVram, readNodeChoices, submitWorkflow, uploadInput, waitForText } from "@/utils/production/comfyui";
import { fail, isWorkflowEnabled, readProduction } from "@/utils/production/config";
import { resolveWorkspacePath } from "@/utils/workspace/files";

export type QcStatus = "ok" | "rejected" | "unverified";
export type QcFinding = { domain: "video" | "audio" | "general"; text: string };
export type QcResult = {
  status: QcStatus;
  findings: QcFinding[];
  videoModelId: string;
  audioModelId: string;
  merged: boolean;
};

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

function readFrameCount(stream: { nb_frames?: string | number; avg_frame_rate?: string; r_frame_rate?: string } | undefined, duration: number) {
  const counted = Number(stream?.nb_frames);
  if (Number.isFinite(counted) && counted > 0) return counted;
  const rate = stream?.avg_frame_rate || stream?.r_frame_rate || "";
  const [num, den] = rate.split("/").map(Number);
  const fps = den ? num / den : num;
  if (Number.isFinite(fps) && fps > 0 && Number.isFinite(duration) && duration > 0) return Math.round(duration * fps);
  return 0;
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

async function runGemmaQc(absoluteVideo: string, prompt: string, variant: GemmaQcVariant, hearAudio: boolean, signal?: AbortSignal) {
  const baseUrl = readProduction().localComfyuiBaseUrl;
  await probeComfy(baseUrl, signal);
  const entry = await findWorkflow(gemmaQcWorkflowIds[variant]);
  if (!isWorkflowEnabled(entry.id)) fail(`${entry.label} 已在设置中关闭`);
  const raw = JSON.parse(await readFile(entry.workflowPath, "utf8")) as Record<string, { inputs?: Record<string, unknown> }>;
  const workflow = structuredClone(raw);
  const loader = workflow["1"]?.inputs;
  const clip = workflow["4"]?.inputs;
  const generate = workflow["5"]?.inputs;
  if (!loader || !clip || !generate) fail("质检工作流节点不完整");
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
    return await waitForText(baseUrl, promptId, signal);
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

function runCommand(command: { on: (event: string, cb: (...args: unknown[]) => void) => unknown; run: () => void; kill: () => void }, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const cancel = () => command.kill();
  signal?.addEventListener("abort", cancel, { once: true });
  return new Promise<void>((resolve, reject) => {
    command.on("start", () => { if (signal?.aborted) command.kill(); });
    command.on("error", (error: unknown) => reject(signal?.aborted ? signal.reason : error));
    command.on("end", () => signal?.aborted ? reject(signal.reason) : resolve());
    command.run();
  }).finally(() => signal?.removeEventListener("abort", cancel));
}

// 抽帧用的 FFmpeg 只能读写临时目录。成片在项目目录里，先复制进来再抽。
function qcSourceName(videoPath: string) {
  const extension = extname(videoPath).toLowerCase();
  return `qc-source${/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".mp4"}`;
}

async function extractEvidence(absoluteVideo: string, workDir: string, signal?: AbortSignal) {
  const ffmpeg = await createWorkspaceFfmpeg(workDir, signal);
  const audioPath = join(workDir, "qc-audio.mp3");
  const framePaths = [0.15, 0.5, 0.85].map((ratio, index) => join(workDir, `qc-frame-${index}.jpg`));

  const probe = await new Promise<{ streams?: { codec_type?: string; disposition?: { attached_pic?: number }; nb_frames?: string | number; avg_frame_rate?: string; r_frame_rate?: string }[]; format?: { duration?: string | number } }>((resolve, reject) => {
    const command = ffmpeg(absoluteVideo);
    const cancel = () => command.kill();
    signal?.addEventListener("abort", cancel, { once: true });
    command.ffprobe((error: unknown, data: unknown) => {
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) reject(signal.reason);
      else if (error) reject(error);
      else resolve(data as { streams?: { codec_type?: string; disposition?: { attached_pic?: number }; nb_frames?: string | number; avg_frame_rate?: string; r_frame_rate?: string }[]; format?: { duration?: string | number } });
    });
  });

  const hasVideo = probe.streams?.some(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  if (!hasVideo) fail("质检目标不是含画面的视频文件");
  const duration = Number(probe.format?.duration ?? 0);
  const hasAudio = probe.streams?.some(stream => stream.codec_type === "audio") === true;

  for (let index = 0; index < framePaths.length; index++) {
    const path = framePaths[index]!;
    const stamp = Number.isFinite(duration) && duration > 0 ? Math.min(duration * [0.15, 0.5, 0.85][index]!, Math.max(duration - 0.05, 0)) : index;
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

  const videoStream = probe.streams?.find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  return { frames, audioBase64: audioBytes ? audioBytes.toString("base64") : undefined, hasAudio, duration, frameCount: readFrameCount(videoStream, duration) };
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

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const body = (fenced ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// 模型常把 text 写成字符串数组。拼回一条，避免结论被丢掉后只剩「质检未通过」。
function findingText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map(item => typeof item === "string" ? item.trim() : "").filter(Boolean).join("\n");
}

const audioPassMark = "音轨合格";
const audioUnverifiedMark = "音轨未验证";
const audioFailMark = "音轨不合格";

function audioVerdict(text: string) {
  if (text.startsWith(audioPassMark)) return "pass" as const;
  if (text.startsWith(audioUnverifiedMark)) return "unverified" as const;
  if (text.startsWith(audioFailMark)) return "problem" as const;
  if (/无法判断|听不清|未提供音轨|没有音轨|缺证据|无法核验/.test(text)) return "unverified" as const;
  return "problem" as const;
}

// 听音轨时必须留下一条 audio。合格句留在结果里，不把整单打成不合格。
function settleHeardAudio(findings: QcFinding[], hasAudio: boolean, claimed: QcStatus): Pick<QcResult, "status" | "findings"> {
  const modelWroteAudio = findings.some(item => item.domain === "audio");
  const kept = hasAudio ? findings : findings.filter(item => item.domain !== "audio");
  if (!hasAudio) kept.push({ domain: "audio", text: `${audioUnverifiedMark}：本片没有音轨` });
  if (hasAudio && !kept.some(item => item.domain === "audio")) {
    kept.push({ domain: "audio", text: `${audioUnverifiedMark}：模型未给出音轨结论` });
  }
  const problems = kept.filter(item => item.domain !== "audio" || audioVerdict(item.text) === "problem");
  const unverified = kept.some(item => item.domain === "audio" && audioVerdict(item.text) === "unverified");
  const passed = kept.some(item => item.domain === "audio" && audioVerdict(item.text) === "pass");
  if (problems.length) return { status: "rejected", findings: kept };
  if (hasAudio && !modelWroteAudio && claimed === "rejected") {
    kept.push({ domain: "general", text: "质检未通过" });
    return { status: "rejected", findings: kept };
  }
  if (unverified || !passed) return { status: "unverified", findings: kept };
  return { status: "ok", findings: kept };
}

function parseQcPayload(text: string, domainHint?: "video" | "audio", hear?: { hasAudio: boolean }): Pick<QcResult, "status" | "findings"> {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    const findings: QcFinding[] = [{ domain: "general", text: "模型未返回可解析的质检 JSON，标为未验证" }];
    if (hear) findings.push({ domain: "audio", text: `${audioUnverifiedMark}：模型未返回可解析的质检 JSON` });
    return { status: "unverified", findings };
  }
  const rawStatus = typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() : "";
  const status: QcStatus = rawStatus === "ok" || rawStatus === "rejected" || rawStatus === "unverified"
    ? rawStatus
    : "unverified";
  const findings: QcFinding[] = [];
  const list = Array.isArray(parsed.findings) ? parsed.findings : [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      findings.push({ domain: domainHint ?? "general", text: item.trim() });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const textValue = findingText(record.text) || findingText(record.message) || findingText(record.reason);
    if (!textValue) continue;
    const domainRaw = typeof record.domain === "string" ? record.domain.trim().toLowerCase() : "";
    const domain = domainRaw === "video" || domainRaw === "audio" || domainRaw === "general"
      ? domainRaw
      : (domainHint ?? "general");
    findings.push({ domain, text: textValue });
  }
  if (hear) return settleHeardAudio(findings, hear.hasAudio, status);
  if (status === "ok" && findings.length) {
    // 只审画面时，ok 不能带条目；有条目则降为 rejected。
    return { status: "rejected", findings };
  }
  if (status !== "ok" && !findings.length) {
    findings.push({ domain: domainHint ?? "general", text: status === "unverified" ? "缺证据，未验证" : "质检未通过" });
  }
  return { status, findings };
}

function mergeResults(video: Pick<QcResult, "status" | "findings">, audio: Pick<QcResult, "status" | "findings">): Pick<QcResult, "status" | "findings"> {
  const findings = [...video.findings, ...audio.findings];
  const statuses = [video.status, audio.status];
  if (statuses.includes("rejected")) return { status: "rejected", findings };
  if (statuses.includes("unverified")) return { status: "unverified", findings };
  return { status: "ok", findings: findings.filter(item => item.domain === "audio" && item.text.startsWith(audioPassMark)) };
}

function videoMime(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "video/mp4";
}

async function visualParts(absoluteVideo: string, inputs: ModelInputs, frames: string[]): Promise<ContentPart[]> {
  if (inputs.image) return frames.map(url => ({ type: "image_url" as const, image_url: { url } }));
  const bytes = await readFile(absoluteVideo);
  if (bytes.length > videoBytesLimit) {
    fail("成片超过 32MB，当前质检模型只接受整段视频。请改用勾选了图像输入的模型，或缩短成片。");
  }
  return [{ type: "video_url", video_url: { url: `data:${videoMime(absoluteVideo)};base64,${bytes.toString("base64")}` } }];
}

function systemContract(kind: "merged" | "video" | "audio", checklist?: string, visual: "frames" | "video" = "frames") {
  const lines = [
    visual === "video"
      ? "你是 Mangaflow 成片质检员。只根据提供的整段视频和/或音轨做验收，不要虚构未给出的证据。"
      : "你是 Mangaflow 成片质检员。只根据提供的画面帧和/或音轨做验收，不要虚构未给出的证据。",
    "只输出一个 JSON 对象，不要其它解释。字段：",
    'status: "ok" | "rejected" | "unverified"',
    'findings: { "domain": "video"|"audio"|"general", "text": string }[]',
    "规则：",
    "- 原则门控：对白是否大致可辨且大体对得上；口型段是否同段；SFX/声景是否乱入；有对白时 BGM 是否盖过人声；画面主体/场景是否离谱。不套外部死数字。",
  ];
  if (kind === "video") {
    lines.push(visual === "video" ? "本轮只审整段视频，domain 用 video。不要写音轨结论。" : "本轮只审画面（抽帧），domain 用 video。不要写音轨结论。");
    lines.push("- ok：符合要求，且 findings 必须为 []");
    lines.push("- rejected：有明确不符，findings 写整改意见");
    lines.push("- unverified：缺证据无法证明，不是通过");
  }
  if (kind === "audio" || kind === "merged") {
    lines.push(`必须有一条 domain=audio，不能省略。听清且合格时 text 以「${audioPassMark}」开头，接着写听到的对白或依据，这不是整改意见。听清但不合格时 text 以「${audioFailMark}」开头并写具体问题。听不清或没有音轨时 text 以「${audioUnverifiedMark}」开头，写缺什么。`);
    if (kind === "merged") lines.push("画面只把不合格项写成 domain=video。写了画面问题也必须另有这条音轨结论。");
    lines.push(`- status：有不合格项用 rejected；没有不合格但音轨未验证用 unverified；${kind === "merged" ? "画面和音轨都合格" : "听清且合格"}才用 ok。ok 时保留「${audioPassMark}」那条，不要为了空数组删掉它。`);
  }
  if (checklist?.trim()) {
    lines.push("验收要点：", checklist.trim().slice(0, 4000));
  }
  return lines.join("\n");
}

export async function runProductionQc(input: {
  directory: string;
  videoPath: string;
  checklist?: string;
  signal?: AbortSignal;
}): Promise<QcResult> {
  const production = readProduction();
  const videoModelId = production.videoQcModelId || defaultQcModelId;
  const audioModelId = production.audioQcModelId || defaultQcModelId;
  if (production.qcLevel === "none") {
    return {
      status: "unverified",
      findings: [{ domain: "general", text: "当前是人工质检，没有调用质检模型。" }],
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
    const evidence = await extractEvidence(localVideo, workDir, input.signal);
    if (gemmaVariant) {
      const hearAudio = production.qcLevel !== "video";
      const usedId = (videoVariant ? videoModelId : audioModelId).trim();
      const lines = hearAudio
        ? [
          systemContract("merged", input.checklist, "video"),
          "输入是整段成片和原音轨。画面大约每秒一帧，时间戳对应该秒。对白听音轨，不要只靠画面猜。能判断的动作按这些帧判断，不要因为不是逐帧就整段 unverified。",
        ]
        : [
          systemContract("video", input.checklist, "video"),
          "本轮只审画面，不要因对白或音轨下结论。",
        ];
      if (hearAudio && !evidence.hasAudio) lines.push("本片没有音轨。对白无法核验，标 unverified。");
      const text = await runGemmaQc(absoluteVideo, lines.join("\n"), gemmaVariant, hearAudio, input.signal);
      const parsed = parseQcPayload(text, undefined, hearAudio ? { hasAudio: evidence.hasAudio } : undefined);
      return {
        ...parsed,
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
        { type: "text", text: systemContract("video", input.checklist, visual) },
        ...await visualParts(absoluteVideo, videoResolved.inputs, evidence.frames),
      ], input.signal);
      const parsed = parseQcPayload(videoText, "video");
      return { ...parsed, videoModelId: videoResolved.modelId, audioModelId: "", merged: false };
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
        { type: "text", text: systemContract("merged", input.checklist, visual) },
        ...await visualParts(absoluteVideo, videoResolved.inputs, evidence.frames),
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
      const parsed = parseQcPayload(text, undefined, { hasAudio: Boolean(evidence.audioBase64) });
      return { ...parsed, videoModelId: videoResolved.modelId, audioModelId: videoResolved.modelId, merged: true };
    }

    const videoText = await completeMultimodal(videoResolved.configured, [
      { type: "text", text: systemContract("video", input.checklist, visual) },
      ...await visualParts(absoluteVideo, videoResolved.inputs, evidence.frames),
    ], input.signal);
    const audioParts: ContentPart[] = [{ type: "text", text: systemContract("audio", input.checklist) }];
    if (evidence.audioBase64) {
      audioParts.push({
        type: "input_audio",
        input_audio: { data: `data:;base64,${evidence.audioBase64}`, format: "mp3" },
      });
    } else {
      audioParts.push({ type: "text", text: "无音轨可听。" });
    }
    const audioText = await completeMultimodal(audioResolved.configured, audioParts, input.signal);
    const mergedResult = mergeResults(parseQcPayload(videoText, "video"), parseQcPayload(audioText, "audio", { hasAudio: Boolean(evidence.audioBase64) }));
    return {
      ...mergedResult,
      videoModelId: videoResolved.modelId,
      audioModelId: audioResolved.modelId,
      merged: false,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
