import { computed, inject, onScopeDispose, ref } from "vue";
import { nodeTools, useNode, useNodeInputs, z } from "@toonflow/nodes-scaffold/runtime";
import { episodeVideoFileName, type ShotVideoContext } from "@toonflow/node-shared/mediaFileName";
import { aspectSchema, checkRange, clipRange, inspectSource, maxClips, renderTimeline, sourcePath, timelineSchema, type Aspect, type Clip } from "./timeline";

export function useVideoTimeline() {
  const host = useNode({ label: "视频剪辑" });
  const { id, node, nodeEvent, files, ffmpeg, outputs } = host;
  const videoContext = inject<(() => ShotVideoContext) | undefined>("shotVideoName", undefined);
  const data = computed(() => node.data as typeof node.data & { clips?: Clip[]; aspect?: Aspect; renderedTimeline?: string });
  const inputs = useNodeInputs();
  const clips = computed(() => timelineSchema.parse(data.value.clips ?? []));
  const aspect = computed(() => aspectSchema.parse(data.value.aspect ?? "portrait"));
  const total = computed(() => clips.value.reduce((sum, clip) => sum + clip.end - clip.start, 0));
  const revision = computed(() => JSON.stringify([aspect.value, clips.value]));
  const dirty = computed(() => data.value.renderedTimeline !== revision.value);
  const connected = computed(() => [...new Set(inputs.getTargetValues(id, "in")
    .flatMap(item => item.dataType === "VIDEO" && item.value && typeof item.value === "object" && "url" in item.value ? [String(item.value.url)] : []))]);
  const editing = ref(false);
  const renderStatus = ref<"idle" | "rendering" | "completed" | "failed" | "cancelled">("idle");
  const progress = ref(0);
  const renderError = ref("");
  const rendering = computed(() => renderStatus.value === "rendering");
  const busy = computed(() => editing.value || rendering.value);
  const output = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
  let controller: AbortController | undefined;
  let job: Promise<void> | undefined;
  let disposed = false;

  function status() {
    const phase = renderStatus.value === "idle" && output.value ? "completed" : renderStatus.value;
    return { status: phase, progress: phase === "completed" ? 100 : progress.value, error: renderError.value || undefined,
      needsRender: dirty.value, output: output.value };
  }

  function requireIdle() {
    if (disposed || busy.value) throw new Error("剪辑节点正在处理素材或导出");
  }

  function findClip(id: string) {
    const clip = clips.value.find(clip => clip.id === id);
    if (!clip) throw new Error("片段已移除，请重新读取时间轴");
    return clip;
  }

  async function readSources(paths: string[], signal?: AbortSignal) {
    editing.value = true;
    try {
      const factory = await ffmpeg(signal);
      const result = [];
      for (const path of paths) {
        const { duration } = await inspectSource(factory, path, signal);
        result.push({ path, duration });
      }
      if (disposed) throw new Error("剪辑节点已关闭");
      signal?.throwIfAborted();
      return result;
    } finally {
      editing.value = false;
    }
  }

  async function add(paths: string[], signal?: AbortSignal) {
    requireIdle();
    if (!paths.length || clips.value.length + paths.length > maxClips) throw new Error(`时间轴须有 1 到 ${maxClips} 个片段`);
    const startRevision = revision.value;
    const sources = await readSources(paths, signal);
    if (revision.value !== startRevision) throw new Error("时间轴已变化，请重试");
    const added = sources.map(item => ({ ...item, id: crypto.randomUUID(), start: 0, end: item.duration }));
    data.value.clips = [...clips.value, ...added];
    return added;
  }

  async function replace(id: string, path: string, signal?: AbortSignal) {
    requireIdle();
    findClip(id);
    const startRevision = revision.value;
    const [source] = await readSources([path], signal);
    if (revision.value !== startRevision) throw new Error("时间轴已变化，请重试");
    // 替换保留片段 ID 和位置，新素材从完整范围开始裁剪。
    const updated = { ...source!, id, start: 0, end: source!.duration };
    data.value.clips = clips.value.map(clip => clip.id === id ? updated : clip);
    return updated;
  }

  function trim(id: string, start: number, end: number) {
    requireIdle();
    const clip = findClip(id);
    checkRange(start, end, clip.duration);
    const updated = { ...clip, start, end };
    data.value.clips = clips.value.map(clip => clip.id === id ? updated : clip);
    return updated;
  }

  function remove(id: string) {
    requireIdle();
    findClip(id);
    data.value.clips = clips.value.filter(clip => clip.id !== id);
  }

  function reorder(ids: string[]) {
    requireIdle();
    if (ids.length !== clips.value.length || new Set(ids).size !== ids.length) throw new Error("排序必须包含当前所有片段，每个片段只出现一次");
    const ordered = ids.map(findClip);
    data.value.clips = ordered;
    return ordered;
  }

  function setAspect(value: Aspect) {
    requireIdle();
    data.value.aspect = value;
    return value;
  }

  function cancel() {
    controller?.abort();
    return status();
  }

  function render() {
    requireIdle();
    if (!clips.value.length) throw new Error("请先添加视频片段");
    const selected = clips.value;
    const selectedAspect = aspect.value;
    const currentRevision = revision.value;
    const workspace = files.getWorkspaceFiles();
    if (!id || /[\\/]/.test(id) || id === "." || id === "..") throw new Error("节点 ID 不能作为文件夹名称");
    const info = videoContext?.();
    if (!info) throw new Error("请在画布中导出成片");
    const fileName = episodeVideoFileName(info.projectName, info.canvasFile);
    const current = controller = new AbortController();
    renderStatus.value = "rendering";
    progress.value = 0;
    renderError.value = "";
    // 独占目录容纳本次导出；失败只清理本次目录，已有成片继续可用。
    const nodeDirectory = `assets/${id}`;
    const renderDirectory = `${nodeDirectory}/${crypto.randomUUID()}`;
    const path = `${renderDirectory}/${fileName}`;
    job = (async () => {
      let created = false;
      try {
        const encoder = await ffmpeg(current.signal);
        for (const path of ["assets", nodeDirectory]) {
          await workspace.mkdir(path).catch(error => {
            if (error?.response?.data?.data?.code !== "EEXIST") throw error;
          });
        }
        current.signal.throwIfAborted();
        await workspace.mkdir(renderDirectory);
        created = true;
        current.signal.throwIfAborted();
        await renderTimeline(encoder, selected, selectedAspect, path, current.signal, value => { progress.value = value; });
        current.signal.throwIfAborted();
        if (revision.value !== currentRevision) throw new Error("时间轴已变化，请重新导出");
        outputs.value.video = { dataType: "VIDEO", value: { url: path, mimeType: "video/mp4" } };
        data.value.renderedTimeline = currentRevision;
        progress.value = 100;
        renderStatus.value = "completed";
      } catch (error) {
        const cancelled = current.signal.aborted;
        renderError.value = cancelled ? "" : error instanceof Error ? error.message : String(error);
        if (created) await workspace.remove(renderDirectory, true).catch(error => {
          renderError.value = [renderError.value, `导出目录清理失败：${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join("。");
        });
        renderStatus.value = cancelled ? "cancelled" : "failed";
      } finally {
        controller = undefined;
      }
    })();
    return status();
  }

  nodeEvent.on("save", reason => {
    if (reason === "reload" && busy.value) throw new Error("请先结束剪辑操作再刷新节点");
  });
  nodeEvent.on("delete", async () => {
    if (editing.value) throw new Error("请先等待素材读取完成");
    cancel();
    await job;
    await files.removeNodeFiles();
  });
  onScopeDispose(() => { disposed = true; cancel(); });

  const clipId = z.uuid();
  const empty = z.strictObject({});
  nodeTools.register({
    name: "getTimeline", description: "读取剪辑片段 ID、素材路径、顺序、裁剪范围、画幅、已连线视频及当前导出状态。",
    parameters: empty, execute: () => ({ clips: clips.value, connectedPaths: connected.value, aspect: aspect.value, duration: total.value, ...status() }),
  });
  nodeTools.register({
    name: "addTimelineClips", description: "按给定顺序加入工作区视频，paths 可来自素材检索或 getTimeline 的 connectedPaths。",
    parameters: z.strictObject({ paths: z.array(sourcePath).min(1).max(maxClips) }),
    execute: ({ paths }, { signal }) => add(paths, signal),
  });
  nodeTools.register({
    name: "replaceTimelineClip", description: "用新的工作区视频替换指定片段，保留位置与 ID，裁剪恢复为新视频的完整范围。",
    parameters: z.strictObject({ clipId, path: sourcePath }), execute: ({ clipId, path }, { signal }) => replace(clipId, path, signal),
  });
  nodeTools.register({
    name: "trimTimelineClip", description: "设置指定片段的源视频入点和出点，单位为秒。",
    parameters: z.strictObject({ clipId, ...clipRange }), execute: ({ clipId, start, end }) => trim(clipId, start, end),
  });
  nodeTools.register({
    name: "removeTimelineClip", description: "从时间轴移除片段，保留原视频文件。",
    parameters: z.strictObject({ clipId }), execute: ({ clipId }) => { remove(clipId); return clips.value; },
  });
  nodeTools.register({
    name: "reorderTimelineClips", description: "用当前全部片段 ID 的新顺序更新剪辑，ID 只能各出现一次。",
    parameters: z.strictObject({ clipIds: z.array(clipId).min(1).max(maxClips) }), execute: ({ clipIds }) => reorder(clipIds),
  });
  nodeTools.register({
    name: "setTimelineAspect", description: "设置导出画幅：portrait 为 9:16，landscape 为 16:9，square 为 1:1。",
    parameters: z.strictObject({ aspect: aspectSchema }), execute: ({ aspect }) => ({ aspect: setAspect(aspect) }),
  });
  nodeTools.register({
    name: "renderTimeline", description: "在当前画布启动宿主 FFmpeg 导出 MP4，立即返回状态。保持画布连接，用 getTimelineRenderStatus 查询完成情况和成片路径。",
    parameters: empty, execute: render,
  });
  nodeTools.register({ name: "getTimelineRenderStatus", description: "查询导出进度、错误和已生成的 MP4。needsRender 表示当前时间轴需要重新导出。",
    parameters: empty, execute: status });
  nodeTools.register({ name: "cancelTimelineRender", description: "取消当前 FFmpeg 导出并保留已有成片。", parameters: empty, execute: cancel });

  return { ...host, clips, aspect, total, connected, busy, rendering, renderStatus, renderError, progress, dirty, output,
    add, replace, trim, remove, reorder, setAspect, render, cancel };
}
