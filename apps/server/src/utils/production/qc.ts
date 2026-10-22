// 成片视听质检：按 settings.production 的视频/音频质检模型调用（默认 qwen3.8-omni-flash），不经 sidecar。
import { mkdtemp, readFile, rm } from "@toonflow/file";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfiguredModel, listAiModels } from "@/utils/ai";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { fail, readProduction } from "@/utils/production/config";
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

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

const defaultQcModelId = "qwen3.8-omni-flash";

function resolveQcModel(modelId: string) {
  const id = modelId.trim() || defaultQcModelId;
  const match = listAiModels().find(item => item.modelId === id);
  if (!match) {
    fail(`质检模型未配置：请在「语言 → 语言模型」中添加 ${id}（或把设置里的质检模型改成已有模型）`);
  }
  return { configured: getConfiguredModel(match.providerId, match.modelId), modelId: match.modelId };
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

async function extractEvidence(absoluteVideo: string, workDir: string, signal?: AbortSignal) {
  const ffmpeg = await createWorkspaceFfmpeg(workDir, signal);
  const audioPath = join(workDir, "qc-audio.mp3");
  const framePaths = [0.15, 0.5, 0.85].map((ratio, index) => join(workDir, `qc-frame-${index}.jpg`));

  const probe = await new Promise<{ streams?: { codec_type?: string; disposition?: { attached_pic?: number } }[]; format?: { duration?: string | number } }>((resolve, reject) => {
    const command = ffmpeg(absoluteVideo);
    const cancel = () => command.kill();
    signal?.addEventListener("abort", cancel, { once: true });
    command.ffprobe((error: unknown, data: unknown) => {
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) reject(signal.reason);
      else if (error) reject(error);
      else resolve(data as { streams?: { codec_type?: string; disposition?: { attached_pic?: number } }[]; format?: { duration?: string | number } });
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

  return { frames, audioBase64: audioBytes ? audioBytes.toString("base64") : undefined, hasAudio, duration };
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

function parseQcPayload(text: string, domainHint?: "video" | "audio"): Pick<QcResult, "status" | "findings"> {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return {
      status: "unverified",
      findings: [{ domain: "general", text: "模型未返回可解析的质检 JSON，标为未验证" }],
    };
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
    const textValue = typeof record.text === "string" ? record.text.trim()
      : typeof record.message === "string" ? record.message.trim()
        : typeof record.reason === "string" ? record.reason.trim() : "";
    if (!textValue) continue;
    const domainRaw = typeof record.domain === "string" ? record.domain.trim().toLowerCase() : "";
    const domain = domainRaw === "video" || domainRaw === "audio" || domainRaw === "general"
      ? domainRaw
      : (domainHint ?? "general");
    findings.push({ domain, text: textValue });
  }
  if (status === "ok" && findings.length) {
    // 合同：ok 时 findings 应为空；有条目则降为 rejected
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
  return { status: "ok", findings: [] };
}

function systemContract(kind: "merged" | "video" | "audio", checklist?: string) {
  const lines = [
    "你是 Mangaflow 成片质检员。只根据提供的画面帧和/或音轨做验收，不要虚构未给出的证据。",
    "只输出一个 JSON 对象，不要其它解释。字段：",
    'status: "ok" | "rejected" | "unverified"',
    'findings: { "domain": "video"|"audio"|"general", "text": string }[]',
    "规则：",
    "- ok：视听均符合要求，且 findings 必须为 []",
    "- rejected：有明确不符，findings 写整改意见",
    "- unverified：缺证据无法证明（例如无音轨却要求听清对白、时序无法从少量帧证明），不是通过",
    "- 原则门控：对白是否大致可辨且大体对得上；口型段是否同段；SFX/声景是否乱入；有对白时 BGM 是否盖过人声；画面主体/场景是否离谱。不套外部死数字。",
  ];
  if (kind === "video") lines.push("本轮只审画面（抽帧），domain 用 video。");
  if (kind === "audio") lines.push("本轮只审音轨，domain 用 audio。无音轨则 status=unverified。");
  if (kind === "merged") lines.push("本轮同时审画面与音轨；findings 用 domain 区分 video/audio。");
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
  const { path: absoluteVideo } = await resolveWorkspacePath(input.directory, input.videoPath);
  const workDir = await mkdtemp(join(tmpdir(), "mangaflow-qc-"));
  try {
    const evidence = await extractEvidence(absoluteVideo, workDir, input.signal);
    const merged = videoModelId === audioModelId;

    if (merged) {
      const { configured, modelId } = resolveQcModel(videoModelId);
      const parts: ContentPart[] = [
        { type: "text", text: systemContract("merged", input.checklist) },
        ...evidence.frames.map(url => ({ type: "image_url" as const, image_url: { url } })),
      ];
      if (evidence.audioBase64) {
        parts.push({
          type: "input_audio",
          input_audio: { data: `data:;base64,${evidence.audioBase64}`, format: "mp3" },
        });
      } else {
        parts.push({ type: "text", text: "（本片未检出音轨；若验收要求听感，应标 unverified。）" });
      }
      const text = await completeMultimodal(configured, parts, input.signal);
      const parsed = parseQcPayload(text);
      return { ...parsed, videoModelId: modelId, audioModelId: modelId, merged: true };
    }

    const videoResolved = resolveQcModel(videoModelId);
    const audioResolved = resolveQcModel(audioModelId);
    const videoText = await completeMultimodal(videoResolved.configured, [
      { type: "text", text: systemContract("video", input.checklist) },
      ...evidence.frames.map(url => ({ type: "image_url" as const, image_url: { url } })),
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
    const mergedResult = mergeResults(parseQcPayload(videoText, "video"), parseQcPayload(audioText, "audio"));
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
