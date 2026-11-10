<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @fullscreen="player?.enterFullscreen()"
    :bottomWidth="660"
    :style="{ width: previewUrl && videoWidth ? `${videoWidth + 18}px` : undefined }">
    <template #topActions>
      <el-button :icon="IconMusic" text :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="actions?.open('extractAudio')">提取音轨</el-button>
      <el-button :icon="IconLayersSubtract" text :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="actions?.open('separate')">分离音视频</el-button>
      <el-button :icon="IconScissors" text :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="actions?.open('trim')">截取片段</el-button>
      <mediaHistory mediaType="video" :current="outputFile" :disabled="generating || deleting || uploading" @select="outputs.video = { dataType: 'VIDEO', value: $event }" />
      <el-button :icon="IconTransfer" :loading="uploading" :disabled="generating || deleting" text title="替换视频" aria-label="替换视频" @click.stop="fileInput?.click()">替换视频</el-button>
      <input ref="fileInput" type="file" accept="video/*" hidden aria-label="选择替换视频" :disabled="generating || deleting || uploading" @change="replaceOutput" />
    </template>
    <template #topRightActions>
      <el-dropdown trigger="click" placement="bottom-end" :disabled="!player?.ready || player?.capturing || generating || deleting || uploading" @command="player?.captureFrame($event)">
        <el-button :icon="IconPhotoScan" :loading="player?.capturing" :disabled="!player?.ready || player?.capturing || generating || deleting || uploading" text title="截取视频帧" aria-label="截取视频帧" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="current" :icon="IconPhotoScan">截取当前帧</el-dropdown-item>
            <el-dropdown-item command="first" :icon="IconPlayerSkipBack">截取首帧</el-dropdown-item>
            <el-dropdown-item command="last" :icon="IconPlayerSkipForward">截取尾帧</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
    <div v-loading="generating || uploading" class="videoContent nopan" :aria-busy="generating || uploading">
      <videoPlayer
        v-if="previewUrl"
        ref="player"
        :src="previewUrl"
        label="生成视频"
        @loadedmetadata="resizeVideo" />
      <div v-else class="videoEmpty" role="img" aria-label="暂无生成视频">
        <icon-camera-ai :size="48" stroke="1.25" aria-hidden="true" />
      </div>
    </div>
    <template #bottom>
      <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <div v-if="data.activeGenerationRequest || detachedGenerationId" class="pendingTask" role="status">
          <div class="pendingTaskText">
            <strong>历史视频任务 · {{ (data.activeGenerationRequest?.generationId || detachedGenerationId).slice(0, 8) }}</strong>
            <span>{{ persistentPhaseLabel }}</span>
            <small v-if="persistentError">{{ persistentError }}</small>
          </div>
          <el-button text size="small" :loading="persistentChecking"
            aria-label="查询原视频任务状态" @click="refreshPersistentStatus().catch(error => showNodeError(error, '任务状态查询失败'))">
            刷新状态
          </el-button>
        </div>
        <div v-if="outputFile && data.lastGenerationId && !data.activeGenerationRequest && !detachedGenerationId" class="pendingTask" role="status">
          <div class="pendingTaskText"><strong>最近一次视频任务</strong><span>{{ completedQcLabel }}</span>
            <small v-if="completedQc.find(item => item.path === outputFile?.url)?.message">{{ completedQc.find(item => item.path === outputFile?.url)?.message }}</small>
          </div>
          <el-button text size="small" :loading="completedQcChecking" :disabled="generating || deleting"
            @click="refreshCompletedQc().catch(error => showNodeError(error, '质检状态查询失败'))">刷新质检</el-button>
        </div>
        <referenceItem
          v-if="refList.length"
          v-model="refList"
          @preview="setReferencePreview"
          @remove="removeReference" />
        <div v-if="frameMode" class="referenceHint">
          {{ selectedMode === "startFrameOptional" ? "仅一张图片时作为尾帧；两张图片按顺序作为首帧、尾帧" : "图片引用按顺序作为首帧、尾帧" }}
        </div>
        <promptInput v-model="data.promptModel" v-model:text="editorText" :references="referenceMentions" expandable placeholder="英文生成提示词（实际发送给视频模型）" />
        <details v-if="data.promptZh.trim()" class="generationEnglish">
          <summary>中文对照（只读，不参与生成）</summary>
          <textarea :value="data.promptZh" class="generationEnglishText" aria-label="中文提示词对照" readonly />
        </details>
        <div class="promptFooter">
          <el-select
            v-model="data.model"
            class="modelSelect"
            filterable
            :loading="modelsLoading"
            :disabled="generating || deleting"
            placeholder="选择模型"
            aria-label="生成模型"
            noDataText="请先在设置中添加视频模型"
            placement="top-start"
            @visible-change="(visible) => visible && loadModels().catch((error) => showNodeError(error, '模型读取失败'))">
            <template #prefix><icon-sparkles :size="17" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option
                v-for="item in provider.models"
                :key="item.modelId"
                :label="item.label"
                :value="JSON.stringify([item.providerId, item.modelId])" />
            </el-option-group>
          </el-select>
          <generationSettings
            v-model:duration="data.duration"
            v-model:resolution="data.resolution"
            v-model:megapixels="data.megapixels"
            v-model:upscale="data.upscale"
            v-model:firstPassSteps="data.firstPassSteps"
            v-model:secondPassSteps="data.secondPassSteps"
            v-model:outputFirstPass="data.outputFirstPass"
            v-model:ratio="data.ratio"
            v-model:mode="data.mode"
            v-model:generateAudio="data.generateAudio"
            v-model:seed="data.seed"
            v-model:seedMode="data.seedMode"
            :lastSeed="data.lastSeed"
            :ratios="ratioOptions"
            :model="selectedModel"
            :disabled="generating || deleting || !selectedModel" />
          <div class="generationActions">
            <mediaPrice v-if="generationInput" :input="{ ...generationInput, mediaType: 'video' }" :supported="selectedModel?.supportsPrice === true" />
            <el-button v-if="!data.activeGenerationRequest && !detachedGenerationId && !generating"
              text size="small" :loading="discoveringRecovery" aria-label="查找该节点历史生成任务"
              @click="discoverRecovery().catch(error => showNodeError(error, '历史任务查询失败'))">历史任务</el-button>
            <el-button
              v-if="(data.activeGenerationRequest || detachedGenerationId) && !generating && !['saved', 'completed'].includes(persistentPhase)"
              text size="small" :disabled="deleting || uploading || persistentPhase === 'submitting' || persistentChecking" title="取消或放弃旧任务（不会重新生成）"
              @click="requestStop().catch(error => showNodeError(error, '放弃旧任务失败'))">放弃旧任务</el-button>
            <el-button
              class="sendButton"
              :icon="generating ? IconPlayerStop : IconArrowUp"
              :disabled="deleting || uploading || (!generating && (data.activeGenerationRequest || detachedGenerationId) && (!persistentPhase || persistentChecking || ['failed', 'cancelled'].includes(persistentPhase))) || (!generating && !data.activeGenerationRequest && !detachedGenerationId && (discoveringRecovery || !generationPrompt || !selectedModel))"
              :title="generating ? '停止生成' : persistentPhase === 'submitting' ? '核对并恢复原任务（不会重新提交）' : data.activeGenerationRequest || detachedGenerationId ? '恢复原视频任务' : '生成视频'"
              :aria-label="generating ? '停止生成' : persistentPhase === 'submitting' ? '核对并恢复原任务（不会重新提交）' : data.activeGenerationRequest || detachedGenerationId ? '恢复原视频任务' : '生成视频'"
              @click="generating ? requestStop().catch((error) => showNodeError(error, '取消视频失败')) : startGeneration().catch((error) => showNodeError(error, '视频生成失败'))" />
          </div>
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
  <videoActions ref="actions" :file="outputFile" :src="previewUrl" :disabled="generating || deleting || uploading" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import { ElButton, ElCard, ElSelect, ElOption, ElOptionGroup, ElLoading, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { IconCameraAi, IconSparkles, IconArrowUp, IconPlayerStop, IconTransfer, IconMusic, IconLayersSubtract, IconScissors, IconPhotoScan, IconPlayerSkipBack, IconPlayerSkipForward } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, useNode, z, type NodeMediaModel, type NodeVideoRequest, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { useNodeGeneration } from "@toonflow/node-shared/useNodeGeneration";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import promptInput from "@toonflow/node-shared/promptInput";
import videoPlayer from "@toonflow/node-video/videoPlayer";
import videoActions from "@toonflow/node-video/videoActions";
import referenceItem from "@toonflow/node-shared/referenceItem";
import mediaHistory from "@toonflow/node-shared/mediaHistory";
import mediaPrice from "@toonflow/node-shared/mediaPrice";
import generationSettings from "./components/generationSettings.vue";

defineOptions({
  inheritAttrs: false,
  icon: IconCameraAi,
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "VIDEO", "AUDIO", "STRING"], label: "图片、视频、音频、文本输入" },
    { id: "video", type: "source", dataType: "VIDEO", label: "视频输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, outputs, files, ai, updateNodeInternals } = useNode({
  label: "视频生成",
});
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
type SeedMode = "fixed" | "random" | "last";
const defaultSeed = 519111680057095;
const data = computed(() => node.data as { prompt: string; promptZh: string; reviewId?: string; promptModel: PromptModel; model: string; duration?: number; resolution: string; megapixels?: number; upscale?: number; firstPassSteps?: number; secondPassSteps?: number; outputFirstPass: boolean; ratio: string; mode: string; generateAudio: boolean; seed: number; seedMode: SeedMode; lastSeed?: number; activeGenerationRequest?: Omit<NodeVideoRequest, "directory">; lastGenerationId?: string });
data.value.prompt ??= "";
data.value.promptZh ??= "";
data.value.promptModel ??= [];
// 主编辑区始终与实际发送的英文 prompt 绑定；中文仅供阅读，手改英文后清除过期译文。
if (data.value.promptZh.trim()) {
  // 旧画布的 promptModel 可能仍是中文，此处恢复为当前实际生效的英文。
  data.value.promptModel = data.value.prompt.split("\n").map((text) => [{ type: "Write", text }]);
}
const editorText = computed({
  get: () => data.value.prompt,
  set: (value: string) => {
    if (data.value.prompt === value) return;
    data.value.prompt = value;
    data.value.promptZh = "";
  },
});
data.value.model ??= "";
data.value.resolution ??= "";
data.value.mode ??= "";
data.value.generateAudio ??= true;
data.value.outputFirstPass ??= false;
data.value.ratio ??= "9:16";
data.value.seedMode ??= "fixed";
data.value.seed ??= defaultSeed;
const { refList, referenceMentions, setReferencePreview, removeReference } = useNodeReferences();
const models = ref<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
let disposed = false;
const deleting = ref(false);
const player = ref<InstanceType<typeof videoPlayer>>();
const actions = ref<InstanceType<typeof videoActions>>();
const videoWidth = ref(0);
let generationController: AbortController | undefined;
const generationState = useNodeGeneration(outputs, () => { void requestStop().catch(error => showNodeError(error, "取消视频失败")); });
const { generating } = generationState;
const persistentPhase = ref("");
const completedQc = ref<{ path: string; status: string; result?: { status: string }; message?: string }[]>([]);
const completedQcChecking = ref(false);
const completedQcLabel = computed(() => {
  const current = completedQc.value.find(item => item.path === outputFile.value?.url);
  if (!current) return "已生成视频 · 待查询质检状态";
  if (current.status === "completed") {
    if (current.result?.status === "ok") return "质检通过 · 可提交用户采用";
    if (current.result?.status === "rejected") return "质检未通过 · 查看问题并定向返工";
    return "质检证据不足 · 需人工核验";
  }
  const labels: Record<string, string> = {
    queued: "质检排队中", running: "质检进行中", notRequested: "未自动质检 · 等待手动审核",
    failed: "质检失败 · 查看错误", interrupted: "质检中断 · 需要恢复",
    awaitingAgent: "待主 Agent 看帧质检 · 尚未完成验收",
  };
  return labels[current.status] ?? "质检状态待确认";
});
const persistentError = ref("");
const persistentChecking = ref(false);
const detachedGenerationId = ref("");
const discoveringRecovery = ref(false);
const persistentPhaseLabels: Record<string, string> = {
  preparing: "准备中 · 可以恢复原任务",
  submitting: "提交状态不明 · 点击恢复只核对原任务，绝不重新提交",
  submitted: "已提交 · 可以继续等待或取回原任务",
  saved: "已保存视频 · 可以恢复成片记录",
  completed: "原任务已完成 · 点击恢复结果",
  cancelled: "已取消 · 放弃旧任务后才能新建",
  failed: "生成失败 · 需要放弃旧任务后重新开始",
};
const persistentPhaseLabel = computed(() =>
  persistentPhaseLabels[persistentPhase.value] ?? "正在查询服务端任务状态");
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
// ACT: 供应商未声明视频比例范围，沿用界面的通用比例，具体支持范围由供应商校验。
const ratioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"];
const selectedModel = computed(() => models.value.find((item) => JSON.stringify([item.providerId, item.modelId]) === data.value.model));
const selectedMode = computed(() => selectedModel.value?.mode?.find((item) => JSON.stringify(item) === data.value.mode) as NodeVideoRequest["mode"]);
const frameMode = computed(() => ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(String(selectedMode.value)));
const mediaCounts = computed(() => ({
  image: refList.value.filter((item) => item.dataType === "IMAGE").length,
  video: refList.value.filter((item) => item.dataType === "VIDEO").length,
  audio: refList.value.filter((item) => item.dataType === "AUDIO").length,
}));
const matchingModes = computed(() => getMatchingModes(selectedModel.value));

function getMatchingModes(choice?: NodeMediaModel) {
  return (choice?.mode ?? []).filter((mode) => {
    const { image, video, audio } = mediaCounts.value;
    if (Array.isArray(mode)) return image + video + audio > 0 && Object.entries(mediaCounts.value).every(([type, count]) =>
      count <= Number(mode.find((item) => item.startsWith(`${type}Reference:`))?.split(":")[1] ?? 0)
    );
    if (mode === "text") return image + video + audio === 0;
    if (video || audio) return false;
    if (mode === "singleImage") return image === 1;
    if (mode === "startEndRequired") return image === 2;
    return ["endFrameOptional", "startFrameOptional"].includes(mode) && image >= 1 && image <= 2;
  });
}

function getDurations(choice: NodeMediaModel) {
  return [...new Set((choice.durationResolutionMap ?? []).flatMap((item) => item.duration))].sort((a, b) => a - b);
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (value == null || !Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function getResolutions(choice: NodeMediaModel, duration?: number) {
  // ACT: 当前视频分辨率使用 p 单位；出现其他单位时再统一换算。
  return [...new Set((choice.durationResolutionMap ?? []).filter((item) => item.duration.includes(duration!)).flatMap((item) => item.resolution))]
    .sort((left, right) => (Number.parseFloat(left) || Infinity) - (Number.parseFloat(right) || Infinity));
}
// ACT: 引用改变时只替换不适用的模式；普通媒体优先作为参考，避免自动变成首尾帧。
watch([selectedModel, matchingModes, () => data.value.mode], ([choice, matches]) => {
  if (!choice || matches.some((item) => JSON.stringify(item) === data.value.mode)) return;
  const modes = choice.mode ?? [];
  const mode = matches.find(Array.isArray) ?? matches.find((item) => item === "singleImage")
    ?? matches.find((item) => item === "endFrameOptional") ?? matches[0]
    ?? modes.find((item) => JSON.stringify(item) === data.value.mode) ?? modes.find(Array.isArray) ?? modes[0];
  data.value.mode = mode === undefined ? "" : JSON.stringify(mode);
}, { flush: "sync" });
// ACT: 参数在节点内归一化，未选中、未挂载底部设置时也可由 Agent 直接生成。
watch([selectedModel, () => data.value.duration], ([choice]) => {
  if (!choice) return;
  const durations = getDurations(choice);
  if (!durations.includes(data.value.duration!)) data.value.duration = durations[0];
  const resolutions = getResolutions(choice, data.value.duration);
  if (!resolutions.includes(data.value.resolution)) data.value.resolution = resolutions[0] ?? "";
  const spec = choice.sampling;
  if (spec) {
    if (!spec.megapixels.includes(data.value.megapixels ?? Number.NaN)) data.value.megapixels = spec.megapixels[0];
    const scale = data.value.upscale;
    if (scale == null || scale < spec.upscaleMin || scale > spec.upscaleMax) data.value.upscale = spec.upscaleDefault;
    if (spec.firstPassDefault != null && spec.firstPassMin != null && spec.firstPassMax != null) {
      data.value.firstPassSteps = clampInt(data.value.firstPassSteps, spec.firstPassMin, spec.firstPassMax, spec.firstPassDefault);
    }
    if (spec.secondPassDefault != null && spec.secondPassMin != null && spec.secondPassMax != null) {
      data.value.secondPassSteps = clampInt(data.value.secondPassSteps, spec.secondPassMin, spec.secondPassMax, spec.secondPassDefault);
    }
  }
  if (!ratioOptions.includes(data.value.ratio)) data.value.ratio = "9:16";
  if (choice.audio !== "optional") data.value.generateAudio = choice.audio === true;
}, { flush: "sync" });
const modelGroups = computed(() => groupNodeModels(models.value));
const generationPrompt = computed(() =>
  [
    data.value.prompt.trim(),
    ...refList.value.flatMap((item, index) => (item.dataType === "STRING" && item.value?.trim() ? [`参考 ${index + 1}：\n${item.value.trim()}`] : [])),
  ]
    .filter(Boolean)
    .join("\n\n")
);
const generationInput = computed<Omit<NodeVideoRequest, "directory"> | undefined>(() => {
  const choice = selectedModel.value;
  if (!choice) return;
  const images = refList.value.flatMap(item => item.dataType === "IMAGE" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []);
  return {
    providerId: choice.providerId,
    modelId: choice.modelId,
    prompt: generationPrompt.value,
    reviewId: data.value.reviewId,
    seedMode: choice.supportsSeed ? data.value.seedMode : undefined,
    mode: selectedMode.value,
    duration: data.value.duration,
    resolution: choice.sampling ? undefined : data.value.resolution || undefined,
    megapixels: choice.sampling && typeof data.value.megapixels === "number" ? data.value.megapixels : undefined,
    upscale: choice.sampling && typeof data.value.upscale === "number" ? data.value.upscale : undefined,
    firstPassSteps: choice.sampling?.firstPassDefault != null ? data.value.firstPassSteps : undefined,
    secondPassSteps: choice.sampling?.secondPassDefault != null ? data.value.secondPassSteps : undefined,
    outputFirstPass: choice.supportsFirstPassOutput ? data.value.outputFirstPass === true : undefined,
    ratio: data.value.ratio,
    generateAudio: choice.audio === "optional" ? data.value.generateAudio : choice.audio,
    outputDirectory: `assets/${id}`,
    images: frameMode.value ? undefined : images,
    firstFrame: frameMode.value && (selectedMode.value !== "startFrameOptional" || images.length > 1) ? images[0] : undefined,
    lastFrame: frameMode.value ? images[selectedMode.value === "startFrameOptional" && images.length === 1 ? 0 : 1] : undefined,
    videos: refList.value.flatMap(item => item.dataType === "VIDEO" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []),
    audios: refList.value.flatMap(item => item.dataType === "AUDIO" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []),
  };
});
const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
const previewUrl = files.useFileUrl(
  outputFile,
  (error) => showNodeError(error, "视频读取失败")
);

onMounted(() => {
  window.addEventListener("toonflow:plugin-installed", refreshProviderModels);
  window.addEventListener("toonflow:provider-config-changed", refreshProviderModels);
  void loadModels().catch(error => { if (!disposed) showNodeError(error, "模型读取失败"); });
  if (data.value.activeGenerationRequest) void refreshPersistentStatus().catch(error => {
    if (!disposed) persistentError.value = error instanceof Error ? error.message : "无法查询历史任务";
  });
  else if (!outputFile.value) void discoverRecovery().catch(error => {
    if (!disposed) showNodeError(error, "历史任务查询失败");
  });
  if (outputFile.value && data.value.lastGenerationId) void refreshCompletedQc().catch(error => {
    if (!disposed) showNodeError(error, "质检状态查询失败");
  });
});
onScopeDispose(() => {
  disposed = true;
  window.removeEventListener("toonflow:plugin-installed", refreshProviderModels);
  window.removeEventListener("toonflow:provider-config-changed", refreshProviderModels);
  generationController?.abort();
});

async function refreshProviderModels(event: Event) {
  if (event.type === "toonflow:plugin-installed" && (event as CustomEvent<{ type?: string }>).detail?.type !== "provider") return;
  try {
    await generation;
    if (!disposed && !deleting.value) await loadModels();
  } catch (error) {
    if (!disposed) showNodeError(error, "模型读取失败");
  }
}

async function replaceOutput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || generating.value || deleting.value || uploading.value || disposed) return;
  if (!file.type.startsWith("video/")) return void showNodeError("请选择视频文件", "视频替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("视频不能为空且不能超过 100 MB", "视频替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 保留历史输出文件，避免破坏撤销记录和复制节点的引用。
    outputs.value.video = { dataType: "VIDEO", value: { url, mimeType: file.type } };
  } catch (error) {
    showNodeError(error, "视频替换失败");
  } finally {
    uploading.value = false;
  }
}

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then((items) => {
    if (disposed || generating.value || deleting.value) return;
    models.value = items.filter((item) => item.type === "video");
    // ACT: 只给空配置选默认模型，保留暂时不可用的旧选择及其参数。
    if (!data.value.model) {
      const first = models.value[0];
      data.value.model = first ? JSON.stringify([first.providerId, first.modelId]) : "";
    }
  }).finally(() => {
    modelsLoading.value = false;
    modelsRequest = undefined;
  });
  return modelsRequest;
}

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** 按种子模式解析本次生成要用的种子 */
function resolveSeed() {
  const mode = data.value.seedMode ?? "fixed";
  if (mode === "fixed") return data.value.seed ?? defaultSeed;
  if (mode === "last") {
    if (data.value.lastSeed == null) throw new Error("暂无随机种子记录，请先使用随机模式生成");
    return data.value.lastSeed;
  }
  return randomSeed();
}

async function requestStop() {
  generationController?.abort();
  const generationId = data.value.activeGenerationRequest?.generationId || detachedGenerationId.value;
  if (!generationId) return;
  const { directory } = await files.getWorkspaceFiles().list();
  const response = await fetch("/api/production/generation/cancel", {
    method: "POST", headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ directory, generationId }),
  });
  const result = await response.json();
  if (!response.ok || result.code !== 200) throw new Error(result.message || "无法确认远端任务已停止");
  const phase = String(result.data?.phase ?? "");
  if (phase !== "cancelled" && phase !== "failed") {
    // 远端视频可能恰好已保存，保留 generationId 以便找回成片，不能直接忘记任务。
    persistentPhase.value = phase;
    persistentError.value = "视频已保存或任务仍在收尾，请先恢复已有结果";
    return;
  }
  data.value.activeGenerationRequest = undefined;
  detachedGenerationId.value = "";
  persistentPhase.value = phase;
  persistentError.value = "";
}

async function persistentGenerationStatus() {
  const activeId = data.value.activeGenerationRequest?.generationId || detachedGenerationId.value;
  const generationId = activeId || data.value.lastGenerationId;
  if (!generationId) return { phase: "idle" };
  const { directory } = await files.getWorkspaceFiles().list();
  const query = new URLSearchParams({ directory, generationId });
  const response = await fetch(`/api/production/generation/status?${query}`, {
    headers: { "x-toonflow-workspace": "1" }, cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || result.code !== 200) throw new Error(result.message || "无法读取历史生成任务");
  // 最近一次已完成任务必须仍对应当前播放的视频，避免误报用户后来替换的成片。
  if (!activeId && !result.data?.files?.some((file: { path?: string }) => file.path === outputFile.value?.url)) return { phase: "idle" };
  return result.data;
}

async function refreshCompletedQc() {
  if (completedQcChecking.value || !data.value.lastGenerationId || !outputFile.value) return;
  completedQcChecking.value = true;
  try {
    const status = await persistentGenerationStatus() as { videoQc?: typeof completedQc.value };
    if (!disposed) completedQc.value = status.videoQc ?? [];
  } finally {
    completedQcChecking.value = false;
  }
}

async function refreshPersistentStatus() {
  if (persistentChecking.value || !(data.value.activeGenerationRequest || detachedGenerationId.value)) return;
  persistentChecking.value = true;
  try {
    const status = await persistentGenerationStatus() as { phase: string; error?: string };
    if (disposed) return;
    persistentPhase.value = status.phase;
    persistentError.value = status.error ?? "";
  } finally {
    persistentChecking.value = false;
  }
}


async function discoverRecovery() {
  if (discoveringRecovery.value || data.value.activeGenerationRequest || detachedGenerationId.value) return;
  discoveringRecovery.value = true;
  try {
    const { directory } = await files.getWorkspaceFiles().list();
    const query = new URLSearchParams({ directory });
    const response = await fetch(`/api/production/generation/list?${query}`, {
      headers: { "x-toonflow-workspace": "1" }, cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok || result.code !== 200 || !Array.isArray(result.data)) {
      throw new Error(result.message || "无法查询工作区任务列表");
    }
    const matching = (result.data as {
      generationId: string; outputDirectory?: string; phase: string; canResumeById?: boolean; error?: string;
    }[]).find(job => job.outputDirectory === `assets/${id}`
      && (job.canResumeById === true || job.phase === "submitting")
      && ["preparing", "submitting", "submitted", "saved", "completed"].includes(job.phase));
    if (disposed || !matching || data.value.activeGenerationRequest) return;
    detachedGenerationId.value = matching.generationId;
    persistentPhase.value = matching.phase;
    persistentError.value = matching.error ?? "";
  } finally {
    discoveringRecovery.value = false;
  }
}

/** 画布丢失活动任务参数后，用服务端原始请求恢复；不会构造新工作流或种子。 */
async function resumeDetachedGeneration() {
  const generationId = detachedGenerationId.value || (persistentPhase.value === "submitting" ? data.value.activeGenerationRequest?.generationId : undefined);
  if (!generationId) throw new Error("没有可恢复的任务");
  if (!["preparing", "submitting", "submitted", "saved", "completed"].includes(persistentPhase.value)) {
    throw new Error("当前 ComfyUI 任务状态不允许恢复；请先查询原队列");
  }
  const controller = new AbortController();
  generationController = controller;
  generation = generationState.run(() => files.getWorkspaceFiles().list()
    .then(async ({ directory }) => {
      const response = await fetch("/api/production/generation/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, generationId }), signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || result.code !== 200) throw new Error(result.message || "无法恢复原任务");
      controller.signal.throwIfAborted();
      const video = result.data?.[0] as { path?: string; mimeType?: string } | undefined;
      if (!video?.path || !video.mimeType) throw new Error("已恢复的任务缺少生成视频");
      if (!disposed) {
        outputs.value.video = { dataType: "VIDEO", value: { url: video.path, mimeType: video.mimeType } };
        data.value.lastGenerationId = generationId;
        void refreshCompletedQc().catch(error => { if (!disposed) showNodeError(error, "质检状态查询失败"); });
        data.value.activeGenerationRequest = undefined;
        detachedGenerationId.value = "";
        persistentPhase.value = "";
        persistentError.value = "";
      }
    })
    .catch(error => {
      if (!disposed) showNodeError(error, "恢复原任务失败");
      if (!disposed && (detachedGenerationId.value || data.value.activeGenerationRequest))
        void refreshPersistentStatus().catch(() => { /* 服务端任务编号仍保留 */ });
    })
    .finally(() => { generationController = undefined; }));
  return { status: "generating", generationId, resumed: true };
}

async function startGeneration() {
  const current = data.value.activeGenerationRequest;
  const choice = selectedModel.value;
  const input = generationInput.value;
  if (generating.value) throw new Error("视频正在生成，请等待完成");
  if (uploading.value) throw new Error("视频正在替换，请等待完成");
  if (deleting.value) throw new Error("节点正在删除");
  if (detachedGenerationId.value || (current && persistentPhase.value === "submitting")) return resumeDetachedGeneration();
  if (!current) {
    if (!choice || !input) throw new Error("请先选择视频模型");
    if (!generationPrompt.value) throw new Error("请输入生成提示词");
    if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
    if (choice.mode?.length && !matchingModes.value.length) throw new Error("当前模型没有适合这些参考素材的生成模式，请更换模型或调整引用");
  }
  // 恢复时必须沿用原模型、参考、审核编号与随机种子，不能取节点后来修改的参数。
  const seed = current?.seed ?? (choice?.supportsSeed ? resolveSeed() : undefined);
  const request: Omit<NodeVideoRequest, "directory"> = current ?? {
    ...input!, seed, ...(choice?.providerId === "comfyui" ? { generationId: crypto.randomUUID() } : {}),
  };
  if (request.generationId && !current) {
    data.value.activeGenerationRequest = request;
    persistentPhase.value = "preparing";
    persistentError.value = "";
  }
  const usedRandomSeed = seed !== undefined && request.seedMode === "random";
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  generationController = controller;
  // 本地刷新仅中止等待；服务端任务由 generationId 继续追踪，主动停止必须请求 /cancel。
  generation = generationState.run(() => workspace
    .list()
    .then(({ directory }) => {
      controller.signal.throwIfAborted();
      return ai.generateVideo({ ...request, directory }, controller.signal);
    })
    .then(([result]) => {
      controller.signal.throwIfAborted();
      if (!result) throw new Error("供应商未返回视频");
      if (usedRandomSeed) data.value.lastSeed = seed;
      outputs.value.video = { dataType: "VIDEO", value: { url: result.path, mimeType: result.mimeType } };
      if (request.generationId) {
        data.value.lastGenerationId = request.generationId;
        data.value.activeGenerationRequest = undefined;
        void refreshCompletedQc().catch(error => { if (!disposed) showNodeError(error, "质检状态查询失败"); });
      }
    }))
    .catch((error) => {
      if (!disposed) showNodeError(error, "视频生成失败");
      if (!disposed && data.value.activeGenerationRequest) {
        void refreshPersistentStatus().catch(() => { /* 任务 ID 保留，用户仍可稍后手动查询 */ });
      }
    })
    .finally(() => {
      generationController = undefined;
    });
  return { status: "generating", seed, generationId: request.generationId, resumed: !!current };
}

nodeEvent.on("save", (reason) => {
  if (reason === "reload" && (generating.value || uploading.value || deleting.value)) throw new Error("视频处理中，请完成后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (uploading.value) throw new Error("视频正在替换，请稍后删除节点");
  deleting.value = true;
  try {
    if (data.value.activeGenerationRequest || detachedGenerationId.value) await requestStop();
    else generationController?.abort();
    await generation;
    await files.removeNodeFiles();
  } finally {
    deleting.value = false;
  }
});

async function resizeVideo(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!video.videoWidth || !video.videoHeight) return;
  videoWidth.value = Math.max(180, (240 * video.videoWidth) / video.videoHeight);
  await nextTick();
  updateNodeInternals();
}

function getConfig() {
  return {
    config: {
      providerId: selectedModel.value?.providerId ?? "",
      modelId: selectedModel.value?.modelId ?? "",
      duration: data.value.duration,
      resolution: data.value.resolution,
      megapixels: data.value.megapixels,
      upscale: data.value.upscale,
      firstPassSteps: data.value.firstPassSteps,
      secondPassSteps: data.value.secondPassSteps,
      outputFirstPass: data.value.outputFirstPass,
      ratio: data.value.ratio,
      mode: selectedMode.value,
      generateAudio: data.value.generateAudio,
      supportsSeed: selectedModel.value?.supportsSeed === true,
      seed: selectedModel.value?.supportsSeed ? data.value.seed : undefined,
      seedMode: selectedModel.value?.supportsSeed ? data.value.seedMode : undefined,
      lastSeed: selectedModel.value?.supportsSeed ? data.value.lastSeed : undefined,
    },
    models: models.value,
    ratios: ratioOptions,
    matchingModes: matchingModes.value,
  };
}

function getPromptContext() {
  const input = generationInput.value;
  if (!input || !input.mode || !matchingModes.value.some(mode => JSON.stringify(mode) === JSON.stringify(input.mode))) {
    throw new Error("请先选择与实际引用匹配的视频工作流和模式");
  }
  if (refList.value.some(item => !item.value || !["IMAGE", "VIDEO", "AUDIO"].includes(item.dataType))) {
    throw new Error("请准备好参考素材，并将文字要求写入分镜合同");
  }
  const config = getConfig().config;
  const { images, videos, audios, firstFrame, lastFrame } = input;
  // 版本覆盖实际请求、种子模式和已有对照，写回时在节点内同步比较。
  const revision = JSON.stringify([input, config, data.value.promptZh]);
  // 随机种子留到实际生成时取值，固定上次随机必须交付具体值供审核绑定。
  const seed = config.supportsSeed && config.seedMode !== "random" ? resolveSeed() : undefined;
  return { config, images, videos, audios, firstFrame, lastFrame, revision, request: { ...input, seed } };
}

nodeTools.register({
  name: "getPromptContext",
  description: "读取视频提示词制作需要的实际工作流、模式、参数、按生成顺序排列的参考及写回版本。",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    await loadModels();
    signal?.throwIfAborted();
    return getPromptContext();
  },
});

nodeTools.register({
  name: "getConfig",
  description: "读取此视频生成节点的当前配置（含种子与种子模式）、可选视频模型能力、通用比例及适合当前引用的模式，不含密钥；时长与分辨率须符合 durationResolutionMap。二采模型看 sampling：用百万像素、放大倍率和一采/二采步数，不使用分辨率；支持一采额外输出的模型还提供 outputFirstPass，默认 false",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    signal?.throwIfAborted();
    return getConfig();
  },
});

nodeTools.register({
  name: "setConfig",
  description: "修改此视频生成节点的模型、时长、分辨率、比例、模式、声音或种子；二采改为百万像素、放大倍率和一采/二采步数，可设置 outputFirstPass 控制是否额外保存一采 MP4（默认 false）；先用 getConfig 查询能力，providerId 与 modelId 必须同时提供；mode 使用返回的原始字符串或数组，须匹配当前引用；不修改提示词、不启动生成",
  parameters: z.strictObject({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    duration: z.number().positive().optional(),
    resolution: z.string().min(1).optional(),
    megapixels: z.number().min(0.1).max(16).optional(),
    upscale: z.number().min(1).max(4).optional(),
    firstPassSteps: z.number().int().min(1).max(64).optional(),
    secondPassSteps: z.number().int().min(1).max(64).optional(),
    outputFirstPass: z.boolean().optional(),
    ratio: z.enum(ratioOptions).optional(),
    mode: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    generateAudio: z.boolean().optional(),
    seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    seedMode: z.enum(["fixed", "random", "last"]).optional(),
  }).superRefine((args, context) => {
    if ((args.providerId === undefined) !== (args.modelId === undefined)) context.addIssue({
      code: "custom", path: [args.providerId === undefined ? "providerId" : "modelId"],
      message: "providerId 与 modelId 必须同时提供，请从 getConfig.models 选择同一项",
    });
  }).refine(args => args.seed === undefined || (args.seedMode !== "random" && args.seedMode !== "last"), {
    path: ["seed"], message: "seedMode=random 或 last 时不能传 seed；要指定种子请显式使用 fixed",
  }).meta({
    // refine 保留执行校验；同一规则显式暴露给工具的 JSON Schema。
    dependencies: { providerId: ["modelId"], modelId: ["providerId"] },
    allOf: [{ if: { required: ["seedMode"], properties: { seedMode: { enum: ["random", "last"] } } }, then: { not: { required: ["seed"] } } }],
  }),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    await loadModels();
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    const choice = args.modelId === undefined ? selectedModel.value
      : models.value.find((item) => item.providerId === args.providerId && item.modelId === args.modelId);
    if (!choice) throw new Error(`模型组合无效：providerId=${args.providerId ?? "未指定"}，modelId=${args.modelId ?? "未选择"}。可选模型：${JSON.stringify(models.value.map(({ providerId, modelId, label }) => ({ providerId, modelId, label })))}。请重新读取 getConfig 后选择，不得替换为未获用户批准的模型。`);
    if (args.outputFirstPass !== undefined && !choice.supportsFirstPassOutput) throw new Error("当前工作流不支持输出一采视频");
    if (!choice.supportsSeed && (args.seed !== undefined || args.seedMode !== undefined)) throw new Error("当前工作流没有绑定种子");
    if (args.seedMode === "last" && data.value.lastSeed == null) throw new Error("暂无随机种子记录");
    if (args.seed !== undefined && (args.seedMode ?? data.value.seedMode) !== "fixed") throw new Error(`字段 seed 与种子模式冲突：当前 seedMode=${data.value.seedMode}，本次 seedMode=${args.seedMode ?? "未指定"}。指定 seed 时必须同时传 seedMode=fixed；使用 random 或 last 时不要传 seed。`);
    const durations = getDurations(choice);
    if (args.duration !== undefined && !durations.includes(args.duration)) throw new Error(`当前模型不支持时长 ${args.duration}，可选：${durations.join("、")}`);
    const duration = args.duration ?? (durations.includes(data.value.duration!) ? data.value.duration : durations[0]);
    const resolutions = getResolutions(choice, duration);
    const spec = choice.sampling;
    if (spec) {
      if (args.resolution !== undefined) throw new Error("二采由百万像素和放大倍率决定，不使用分辨率");
      if (args.megapixels !== undefined && !spec.megapixels.includes(args.megapixels)) throw new Error(`采样百万像素须是 ${spec.megapixels.join("、")}`);
      if (args.upscale !== undefined && (args.upscale < spec.upscaleMin || args.upscale > spec.upscaleMax)) throw new Error(`放大倍率需要在 ${spec.upscaleMin} 到 ${spec.upscaleMax}`);
      if (spec.firstPassDefault != null && spec.firstPassMin != null && spec.firstPassMax != null && spec.secondPassDefault != null && spec.secondPassMin != null && spec.secondPassMax != null) {
        if (args.firstPassSteps !== undefined && (args.firstPassSteps < spec.firstPassMin || args.firstPassSteps > spec.firstPassMax)) throw new Error(`一采步数需要在 ${spec.firstPassMin} 到 ${spec.firstPassMax}`);
        if (args.secondPassSteps !== undefined && (args.secondPassSteps < spec.secondPassMin || args.secondPassSteps > spec.secondPassMax)) throw new Error(`二采步数需要在 ${spec.secondPassMin} 到 ${spec.secondPassMax}`);
      } else if (args.firstPassSteps !== undefined || args.secondPassSteps !== undefined) {
        throw new Error("当前模型不使用一采步数或二采步数");
      }
    } else if (args.megapixels !== undefined || args.upscale !== undefined || args.firstPassSteps !== undefined || args.secondPassSteps !== undefined) {
      throw new Error("当前模型不使用采样百万像素、放大倍率或一二采步数");
    } else if (args.resolution !== undefined && !resolutions.includes(args.resolution)) {
      throw new Error(`当前时长不支持分辨率 ${args.resolution}，可选：${resolutions.join("、")}`);
    }
    const resolution = args.resolution ?? (resolutions.includes(data.value.resolution) ? data.value.resolution : resolutions[0] ?? "");
    if (args.mode !== undefined && !getMatchingModes(choice).some((item) => JSON.stringify(item) === JSON.stringify(args.mode))) throw new Error(`字段 mode=${JSON.stringify(args.mode)} 不适用于当前模型和引用。允许值：${JSON.stringify(getMatchingModes(choice))}。请重新读取 getConfig 确认。`);
    if (args.generateAudio !== undefined && choice.audio !== "optional" && args.generateAudio !== (choice.audio === true)) throw new Error("当前模型不支持切换声音，请查看 getConfig 返回的 audio 能力");
    data.value.model = JSON.stringify([choice.providerId, choice.modelId]);
    data.value.duration = duration;
    data.value.resolution = resolution;
    if (spec) {
      if (args.megapixels !== undefined) data.value.megapixels = args.megapixels;
      else if (!spec.megapixels.includes(data.value.megapixels ?? Number.NaN)) data.value.megapixels = spec.megapixels[0];
      if (args.upscale !== undefined) data.value.upscale = args.upscale;
      else if (data.value.upscale == null) data.value.upscale = spec.upscaleDefault;
      if (spec.firstPassDefault != null && spec.firstPassMin != null && spec.firstPassMax != null) {
        data.value.firstPassSteps = args.firstPassSteps ?? clampInt(data.value.firstPassSteps, spec.firstPassMin, spec.firstPassMax, spec.firstPassDefault);
      }
      if (spec.secondPassDefault != null && spec.secondPassMin != null && spec.secondPassMax != null) {
        data.value.secondPassSteps = args.secondPassSteps ?? clampInt(data.value.secondPassSteps, spec.secondPassMin, spec.secondPassMax, spec.secondPassDefault);
      }
    }
    if (args.ratio !== undefined) data.value.ratio = args.ratio;
    if (args.mode !== undefined) data.value.mode = JSON.stringify(args.mode);
    if (args.generateAudio !== undefined) data.value.generateAudio = args.generateAudio;
    if (args.outputFirstPass !== undefined) data.value.outputFirstPass = args.outputFirstPass;
    if (args.seedMode !== undefined) data.value.seedMode = args.seedMode;
    if (args.seed !== undefined) data.value.seed = args.seed;
    return getConfig();
  },
});

nodeTools.register({
  name: "setPrompt",
  description: "修改此节点的视频提示词，支持 {{ref 1}} 等参考标记。prompt 是送去生成并在主编辑区显示的英文；promptZh 是只读的简体中文对照，不进入生成。成片提示词两者都要传。H3 的 reviewId 使用 draftVideoPrompt 返回的服务端编号；编号随实际请求由服务端校验。只修改提示词，不启动生成",
  parameters: z.strictObject({ prompt: z.string(), promptZh: z.string().optional(), reviewId: z.string().uuid().optional(), expectedRevision: z.string().optional() }),
  execute({ prompt: value, promptZh, reviewId, expectedRevision }) {
    if (deleting.value) throw new Error("节点正在删除，请稍后修改");
    if (expectedRevision !== undefined && (generating.value || getPromptContext().revision !== expectedRevision)) {
      throw new Error("视频节点在审稿期间已变化，请重新制作提示词");
    }
    data.value.prompt = value;
    data.value.promptZh = promptZh ?? "";
    data.value.reviewId = reviewId;
    data.value.promptModel = value.split("\n").map((text) => [{ type: "Write", text }]);
    return { prompt: value, promptZh: data.value.promptZh, reviewId: data.value.reviewId };
  },
});

nodeTools.register({
  name: "getPersistentGenerationStatus",
  description: "查询此节点正在执行或最近已完成任务的成片及 videoQc。awaitingAgent 表示待当前主 Agent 用 getVideoQcFrames 看图并 submitVideoQc 提交逐项结论，不能视为验收完成。不启动生成或质检。",
  parameters: z.strictObject({}),
  async execute() { return persistentGenerationStatus(); },
});

nodeTools.register({
  name: "cancelPersistentGeneration",
  description: "显式停止或放弃当前记录的 ComfyUI 视频任务；仅用于用户授权停止生成时，不会启动新任务。",
  parameters: z.strictObject({}),
  async execute() {
    if (!data.value.activeGenerationRequest && !detachedGenerationId.value) return { cancellationRequested: false };
    await requestStop();
    return { cancellationRequested: true };
  },
});

nodeTools.register({
  name: "generateVideo",
  description: "首次生成会持久化 generationId 和原始参数；刷新后再次调用只恢复原 ComfyUI 任务，不重新提交。用 getGenerationStatus 查询当前节点执行状态、getPersistentGenerationStatus 查询持久化状态，cancelGeneration 显式停止",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    return startGeneration();
  },
});
</script>

<style scoped lang="scss">
.videoContent {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .videoEmpty {
    display: grid;
    place-items: center;
    min-height: 144px;
    color: var(--el-text-color-placeholder);
  }

  :deep(.el-loading-mask) {
    pointer-events: none;
  }

}

.promptCard {
  .pendingTask {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
    padding: 9px 11px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 9px;
    background: var(--el-fill-color-light);
    .pendingTaskText {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 11px;
      color: var(--el-text-color-regular);
      strong { color: var(--el-text-color-primary); }
      small { color: var(--el-color-warning); line-height: 1.5; }
    }
  }
  .referenceHint {
    margin: 8px 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .generationEnglish {
    margin-top: 8px;

    summary {
      cursor: pointer;
      color: var(--el-text-color-secondary);
    }
  }

  .generationEnglishText {
    box-sizing: border-box;
    width: 100%;
    min-height: 96px;
    margin-top: 6px;
    padding: 8px;
    resize: vertical;
    border: 1px solid var(--el-border-color);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-regular);
    font: inherit;
  }

  .promptFooter {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;

    .modelSelect {
      width: 190px;
      min-width: 0;

      &:deep(.el-select__wrapper) {
        gap: 6px;
        padding: 0;
        box-shadow: none;
        background: transparent;
      }
    }

    .generationActions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;

      .sendButton {
        width: 32px;
        height: 32px;
        margin-left: 0;
        padding: 0;
        --el-button-bg-color: var(--el-text-color-primary);
        --el-button-border-color: transparent;
        --el-button-text-color: var(--el-bg-color);
        --el-button-hover-bg-color: var(--el-text-color-regular);
        --el-button-hover-border-color: transparent;
        --el-button-hover-text-color: var(--el-bg-color);
      }
    }
  }
}
</style>
