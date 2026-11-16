import { z } from "@toonflow/nodes-scaffold/nodeTools";
import type { BrowserFfmpegFactory } from "@toonflow/nodes-scaffold/nodeFfmpeg";
import { probeMedia, runVideoCommand } from "@toonflow/node-shared/videoCommands";

export const maxClips = 32;
export const minClipSeconds = 1 / 24;
export const sourcePath = z.string().min(1).max(4096).refine(path =>
  !/^[\\/]|[:\x00-\x1f]/.test(path) && path.split(/[\\/]/).every(part => part && part !== "." && part !== ".."),
  "使用工作区内的视频相对路径");
export const clipRange = { start: z.number().finite().nonnegative(), end: z.number().finite().positive() };
const clipSchema = z.strictObject({ id: z.uuid(), path: sourcePath, duration: z.number().finite().positive(), ...clipRange });
export const timelineSchema = z.array(clipSchema).max(maxClips);
export type Clip = z.infer<typeof clipSchema>;
export const frameSizes = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080] } as const;
export const aspectSchema = z.enum(["landscape", "portrait", "square"]);
export type Aspect = z.infer<typeof aspectSchema>;
// 剪辑只接收视频容器，避免输入清单或协议间接访问其他文件和网络。
const inputOptions = ["-protocol_whitelist", "file", "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,mpeg,flv,ogg"];
const outputOptions = ["-map", "[v]", "-map", "[a]", "-preset", "fast", "-crf", "18", "-movflags", "+faststart"];

export function checkRange(start: number, end: number, duration: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end - start < minClipSeconds) {
    throw new Error("裁剪范围须在视频时长内，且至少保留一帧");
  }
}

export async function inspectSource(ffmpeg: BrowserFfmpegFactory, path: string, signal?: AbortSignal) {
  const data = await probeMedia(ffmpeg, sourcePath.parse(path), signal, inputOptions);
  const video = data.streams.find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  if (!video || !Number.isInteger(video.index)) throw new Error(`文件没有可用的视频轨：${path}`);
  const duration = Number(video.duration ?? data.format.duration);
  if (!Number.isFinite(duration) || duration < minClipSeconds) throw new Error(`无法读取有效的视频时长：${path}`);
  const audio = data.streams.find(stream => stream.codec_type === "audio");
  return { duration, videoIndex: video.index, audioIndex: audio && Number.isInteger(audio.index) ? audio.index : undefined };
}

export async function renderTimeline(ffmpeg: BrowserFfmpegFactory, clips: Clip[], aspect: Aspect, output: string,
  signal: AbortSignal, onProgress: (value: number) => void) {
  const [width, height] = frameSizes[aspect];
  const command = ffmpeg();
  const filters: string[] = [];
  const media = new Map<string, Awaited<ReturnType<typeof inspectSource>>>();
  const seconds = (value: number) => value.toFixed(6);
  let totalSeconds = 0;
  for (const [index, clip] of clips.entries()) {
    let info = media.get(clip.path);
    if (!info) {
      info = await inspectSource(ffmpeg, clip.path, signal);
      media.set(clip.path, info);
    }
    checkRange(clip.start, clip.end, info.duration);
    const length = seconds(clip.end - clip.start);
    totalSeconds += clip.end - clip.start;
    command.input(clip.path).inputOptions(inputOptions).seekInput(clip.start);
    // 同一滤镜图统一画幅、帧率和音轨。补齐静音尾部，使下一镜头的声画从同一时间点开始。
    filters.push(`[${index}:${info.videoIndex}]setpts=PTS-STARTPTS,fps=24,trim=duration=${length},scale='max(2,trunc(min(${width},${height}*dar)/2)*2)':'max(2,trunc(min(${height},${width}/dar)/2)*2)',setsar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[v${index}]`);
    const audio = info.audioIndex === undefined ? "anullsrc=r=48000:cl=stereo" :
      `[${index}:${info.audioIndex}]aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo,apad`;
    filters.push(`${audio},atrim=duration=${length},asetpts=PTS-STARTPTS[a${index}]`);
  }
  filters.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${clips.length}:v=1:a=1[v][a]`);
  await runVideoCommand(command.complexFilter(filters).output(output)
    .videoCodec("libx264").audioCodec("aac").audioBitrate(192).format("mp4")
    .outputOptions(outputOptions)
    .on("progress", ({ timemark }) => {
      const parts = timemark?.split(":").map(Number) ?? [];
      if (parts.length === 3 && parts.every(Number.isFinite)) {
        const elapsed = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
        onProgress(Math.min(99, Math.floor(100 * elapsed / totalSeconds)));
      }
    }), signal);
  await inspectSource(ffmpeg, output, signal);
}
