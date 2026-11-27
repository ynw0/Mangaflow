<template>
  <nodeSkeleton v-bind="nodeProps" :downloadUrl="outputUrl" :downloadName="outputName">
    <div class="editor nopan nodrag nowheel">
      <video v-if="outputUrl" class="outputPreview" :src="outputUrl" controls playsinline preload="metadata" aria-label="成片预览" />
      <div class="toolbar">
        <el-button size="small" :disabled="busy" @click="openEditor()">编辑时间轴</el-button>
        <span class="time">{{ clips.length }} 段 · {{ formatTime(total) }}</span>
        <el-button v-if="rendering" size="small" @click="cancel()">取消导出</el-button>
        <el-button v-else type="primary" size="small" :disabled="busy || !clips.length" @click="exportVideo">导出 MP4</el-button>
      </div>
      <div v-if="output" class="fileActions" @pointerdown.stop @mousedown.stop @dblclick.stop>
        <el-button
          size="small"
          :icon="IconDownload"
          :tag="outputUrl && !rendering ? 'a' : 'button'"
          :href="outputUrl && !rendering ? outputUrl : undefined"
          :download="outputName"
          :loading="downloading"
          :disabled="!outputUrl || rendering || downloading"
          @downloadstate="downloading = $event.detail"
          @click.stop>下载视频</el-button>
        <el-button size="small" :icon="IconFolder" :loading="revealing" :disabled="rendering || revealing" title="在本机文件管理器中定位成片（远程访问请下载）" @click.stop="revealOutput">打开文件位置</el-button>
      </div>
      <div v-if="rendering" class="renderProgress" role="status">正在导出 {{ progress }}%<el-progress :percentage="progress" :showText="false" /></div>
      <p v-else-if="renderError" class="error" role="alert">{{ renderError }}</p>
      <p v-else-if="renderStatus === 'cancelled'" class="status" role="status">已取消导出</p>
      <p v-else-if="output && dirty" class="status">时间轴已修改，预览为上次导出的成片</p>
    </div>
  </nodeSkeleton>

  <el-dialog v-model="visible" title="视频剪辑" width="min(920px, 94vw)" appendToBody destroyOnClose>
    <div class="workspace" @drop.stop>
      <div class="tools">
        <el-select v-model="source" filterable allowCreate defaultFirstOption size="small" placeholder="选择已连线视频或输入工作区相对路径" aria-label="视频素材" :disabled="busy">
          <el-option v-for="path in connected" :key="path" :label="path" :value="path" />
        </el-select>
        <el-button size="small" :disabled="busy || !source || clips.length >= maxClips" @click="appendSource">添加</el-button>
        <el-button size="small" :disabled="busy || !source || !selected" @click="replaceSource">替换选中片段</el-button>
        <el-select :modelValue="aspect" size="small" aria-label="成片画幅" :disabled="busy" @update:modelValue="changeAspect">
          <el-option label="竖屏 9:16" value="portrait" />
          <el-option label="横屏 16:9" value="landscape" />
          <el-option label="方形 1:1" value="square" />
        </el-select>
      </div>
      <div v-if="clips.length" class="timeline" aria-label="剪辑片段顺序">
        <div v-for="(clip, index) in clips" :key="clip.id" class="clip"
          :class="{ selected: clip.id === selectedId }" :style="{ flexGrow: clip.end - clip.start }"
          :draggable="!busy" @dragstart="dragClip($event, clip.id)" @dragend="draggedId = ''"
          @dragover.prevent @drop.prevent="dropClip(clip.id)">
          <button type="button" :aria-pressed="clip.id === selectedId" @click="selectClip(clip)">
            <span class="clipTime">{{ formatTime(offsets[index]!) }}</span>
            <span class="clipName" :title="clip.path">{{ clip.path.split(/[\\/]/).at(-1) }}</span>
            <span class="clipTime">{{ formatTime(clip.end - clip.start) }}</span>
          </button>
        </div>
      </div>
      <div v-if="selected" class="inspector">
        <video v-if="sourceUrl" ref="preview" :key="selected.id + selected.path" class="sourcePreview"
          :src="sourceUrl" controls playsinline preload="metadata" aria-label="选中片段预览"
          @loadedmetadata="seekToStart" @play="startClipPreview" @timeupdate="stopAtEnd" />
        <div class="clipControls">
          <label>入点（秒）<el-input-number v-model="start" :min="0" :max="selected.duration" :step="0.1" size="small" :disabled="busy" /></label>
          <label>出点（秒）<el-input-number v-model="end" :min="0" :max="selected.duration" :step="0.1" size="small" :disabled="busy" /></label>
          <el-button size="small" :disabled="busy" @click="applyTrim">应用裁剪</el-button>
          <el-button size="small" :disabled="busy || selectedIndex <= 0" @click="moveClip(-1)">前移</el-button>
          <el-button size="small" :disabled="busy || selectedIndex >= clips.length - 1" @click="moveClip(1)">后移</el-button>
          <el-button size="small" :disabled="busy" @click="removeClip">移除片段</el-button>
        </div>
      </div>
      <div class="footer">
        <span class="time">总时长 {{ formatTime(total) }}</span>
        <span v-if="rendering" role="status">正在导出 {{ progress }}%</span>
        <el-button v-if="rendering" size="small" @click="cancel()">取消导出</el-button>
        <el-button v-else type="primary" size="small" :disabled="busy || !clips.length" @click="exportVideo">导出 MP4</el-button>
      </div>
      <p v-if="renderError" class="error" role="alert">{{ renderError }}</p>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElDialog, ElInputNumber, ElOption, ElProgress, ElSelect } from "element-plus";
import { IconScissors, IconDownload, IconFolder } from "@tabler/icons-vue";
import { nodeSkeleton, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { aspectSchema, maxClips, type Clip } from "./timeline";
import { useVideoTimeline } from "./useVideoTimeline";

defineOptions({
  inheritAttrs: false,
  icon: IconScissors,
  handles: [
    { id: "in", type: "target", dataType: "VIDEO", label: "视频素材" },
    { id: "video", type: "source", dataType: "VIDEO", label: "成片" },
  ] satisfies NodeHandle[],
});
const { nodeProps, files, clips, aspect, total, connected, busy, rendering, renderStatus, renderError, progress, dirty, output,
  add, replace, trim, remove, reorder, setAspect, render, cancel } = useVideoTimeline();
const visible = ref(false);
const source = ref("");
const selectedId = ref("");
const draggedId = ref("");
const start = ref<number | undefined>();
const end = ref<number | undefined>();
const preview = ref<HTMLVideoElement>();
const selectedIndex = computed(() => clips.value.findIndex(clip => clip.id === selectedId.value));
const selected = computed(() => clips.value[selectedIndex.value]);
const offsets = computed(() => {
  let offset = 0;
  return clips.value.map(clip => { const value = offset; offset += clip.end - clip.start; return value; });
});
const sourceUrl = files.useFileUrl(computed(() => visible.value && selected.value ? { url: selected.value.path, mimeType: "video/mp4" } : undefined),
  error => showNodeError(error, "片段预览失败"));
const outputUrl = computed(() => {
  const path = output.value?.url;
  const mediaUrl = path ? files.getWorkspaceFiles().mediaUrl?.(path) : "";
  return mediaUrl || "";
});
const outputName = computed(() => output.value?.url.split(/[\\/]/).at(-1) || "video.mp4");
const downloading = ref(false);
const revealing = ref(false);
async function revealOutput() {
  const path = output.value?.url;
  if (!path || rendering.value || revealing.value) return;
  revealing.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    if (!workspace.reveal) throw new Error("当前宿主不支持定位文件，请下载视频后查看。");
    await workspace.reveal(path);
  } catch (error) { showNodeError(error, "打开文件位置失败"); }
  finally { revealing.value = false; }
}

watch(() => [selected.value?.id, selected.value?.path, selected.value?.start, selected.value?.end], () => {
  start.value = selected.value?.start;
  end.value = selected.value?.end;
});

function formatTime(value: number) {
  const ticks = Math.round(value * 100);
  return `${String(Math.floor(ticks / 6000)).padStart(2, "0")}:${(ticks % 6000 / 100).toFixed(2).padStart(5, "0")}`;
}
function selectClip(clip: Clip) {
  selectedId.value = clip.id;
}
function openEditor() {
  if (!selected.value && clips.value[0]) selectClip(clips.value[0]);
  if (!source.value && connected.value[0]) source.value = connected.value[0];
  visible.value = true;
}
function seekToStart() {
  if (preview.value && selected.value) preview.value.currentTime = selected.value.start;
}
function startClipPreview() {
  if (!preview.value || !selected.value) return;
  if (preview.value.currentTime < selected.value.start || preview.value.currentTime >= selected.value.end) seekToStart();
}
function stopAtEnd() {
  if (preview.value && selected.value && preview.value.currentTime >= selected.value.end) preview.value.pause();
}
async function appendSource() {
  try { const [clip] = await add([source.value]); if (clip) selectClip(clip); }
  catch (error) { showNodeError(error, "添加片段失败"); }
}
async function replaceSource() {
  if (!selected.value) return;
  try { await replace(selected.value.id, source.value); }
  catch (error) { showNodeError(error, "替换片段失败"); }
}
function applyTrim() {
  if (!selected.value) return;
  try { trim(selected.value.id, start.value ?? NaN, end.value ?? NaN); seekToStart(); }
  catch (error) { showNodeError(error, "裁剪失败"); }
}
function removeClip() {
  if (!selected.value) return;
  const index = selectedIndex.value;
  try { remove(selected.value.id); selectedId.value = clips.value[Math.min(index, clips.value.length - 1)]?.id ?? ""; }
  catch (error) { showNodeError(error, "移除片段失败"); }
}
function move(from: number, to: number) {
  const ids = clips.value.map(clip => clip.id);
  if (busy.value || from < 0 || to < 0 || to >= ids.length || from === to) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]!);
  try { reorder(ids); }
  catch (error) { showNodeError(error, "排序失败"); }
}
function moveClip(offset: number) { move(selectedIndex.value, selectedIndex.value + offset); }
function dragClip(event: DragEvent, id: string) {
  draggedId.value = id;
  event.dataTransfer?.setData("text/plain", id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}
function dropClip(targetId: string) {
  move(clips.value.findIndex(clip => clip.id === draggedId.value), clips.value.findIndex(clip => clip.id === targetId));
  draggedId.value = "";
}
function changeAspect(value: unknown) {
  try { setAspect(aspectSchema.parse(value)); }
  catch (error) { showNodeError(error, "更改画幅失败"); }
}
function exportVideo() {
  try { render(); }
  catch (error) { showNodeError(error, "成片导出失败"); }
}
</script>

<style scoped lang="scss">
.editor, .workspace {
  display: grid;
  gap: 12px;
  .time, .clipTime {
    font-variant-numeric: tabular-nums;
    color: var(--el-text-color-secondary);
  }
  .error {
    margin: 0;
    color: var(--el-color-danger);
    overflow-wrap: anywhere;
  }
}
.editor {
  width: 360px;
  .outputPreview {
    width: 100%;
    max-height: 280px;
    background: #14191d;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .fileActions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    :deep(.el-button + .el-button) { margin-left: 0; }
  }
  .renderProgress, .status {
    margin: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}
.workspace {
  .tools, .clipControls, .footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    :deep(.el-button + .el-button) { margin-left: 0; }
  }
  .tools {
    :deep(.el-select:first-child) { flex: 1 1 270px; min-width: 160px; }
    :deep(.el-select:last-child) { width: 132px; }
  }
  .timeline {
    display: flex;
    gap: 5px;
    padding: 8px;
    overflow-x: auto;
    background: #181f24;
    border-radius: 5px;
    .clip {
      flex-basis: 0;
      min-width: 128px;
      border: 1px solid #50636a;
      border-radius: 4px;
      background: #26383d;
      &.selected { border-color: #6de0bd; background: #204740; }
      button {
        display: grid;
        gap: 6px;
        width: 100%;
        text-align: left;
        padding: 9px;
        border: 0;
        background: transparent;
        color: #f0faf6;
        cursor: pointer;
        .clipTime { color: #bcdbd4; font-size: 11px; }
        .clipName { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      }
    }
  }
  .inspector {
    display: grid;
    gap: 10px;
    .sourcePreview { width: 100%; max-height: 300px; background: #14191d; }
    .clipControls label { display: inline-flex; align-items: center; gap: 6px; }
  }
  .footer {
    justify-content: flex-end;
    .time { margin-right: auto; }
  }
}
</style>
