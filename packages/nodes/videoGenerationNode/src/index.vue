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
          <el-button v-if="persistentError || ['submitting', 'submitted', 'failed'].includes(persistentPhase)"
            text size="small" @click="openComfyDiagnosis">分析 ComfyUI 报错</el-button>
        </div>
        <div v-if="outputFile && data.lastGenerationId && !data.activeGenerationRequest && !detachedGenerationId" class="pendingTask" role="status">
          <div class="pendingTaskText"><strong>最近一次视频任务</strong><span>{{ completedQcLabel }}</span>
            <small v-if="currentQc?.result?.videoModelId" style="overflow-wrap:anywhere">质检模型：{{ currentQc.result.videoModelId.replace(/^qc\/gemma4:/, "") }}</small>
            <small v-if="completedQc.find(item => item.path === outputFile?.url)?.message">{{ completedQc.find(item => item.path === outputFile?.url)?.message }}</small>
          </div>
          <el-button text size="small" :loading="completedQcChecking" :disabled="generating || deleting"
            @click="refreshCompletedQc().catch(error => showNodeError(error, '质检状态查询失败'))">刷新质检</el-button>
        </div>
        <details v-if="currentQc?.status === 'completed' && currentQc.result?.issues?.length" class="qcProblemPanel">
          <summary>QC 问题清单（{{ currentQc.result.issues.length }} 项）</summary>
          <ol>
            <li v-for="issue in currentQc.result.issues" :key="issue.id">
              <strong>{{ issue.kind === 'defect' ? '失败' : '待核实' }} · {{ issue.requirementId ?? issue.domain }}</strong>
              <span>{{ issue.problem }}</span>
              <small v-if="issue.time">{{ issue.time }}</small>
              <small v-if="issue.expected">应达到：{{ issue.expected }}</small>
              <small v-if="issue.fixHint">检查方向：{{ issue.fixHint }}</small>
            </li>
          </ol>
        </details>
        <details v-if="currentQc?.rectificationPlan" class="qcProblemPanel">
          <summary>主 Agent 整改方案（{{ currentQc.rectificationPlan.actions.length }} 项）</summary>
          <p>{{ currentQc.rectificationPlan.summary }}</p>
          <ol>
            <li v-for="(action, index) in currentQc.rectificationPlan.actions" :key="index">
              <strong>{{ action.category }} · {{ action.issueIds.join('、') }}</strong>
              <span>{{ action.change }}</span>
              <small>验收：{{ action.acceptance }}</small>
            </li>
          </ol>
          <small>此方案仅为整改计划，未自动提交新的视频生成。</small>
        </details>
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
            v-model:loraName="data.loraName"
            v-model:manualAccelerationLoras="data.manualAccelerationLoras"
            v-model:h3Options="data.h3Options"
            :samplerChoices="samplerChoices"
            :schedulerChoices="schedulerChoices"
            :advancedError="advancedError"
            v-model:checkpointKind="checkpointKind"
            v-model:checkpointName="data.checkpointName"
            v-model:ratio="data.ratio"
            v-model:mode="data.mode"
            v-model:generateAudio="data.generateAudio"
            v-model:seed="data.seed"
            v-model:seedMode="data.seedMode"
            :lastSeed="data.lastSeed"
            :loraChoices="loraChoices"
            :checkpointChoices="checkpointChoices"
            v-model:qcOverride="data.qcOverride"
            :qcChoices="qcChoices"
            :qcDefaults="qcDefaults"
            :qcError="qcChoiceError"
            :qcLoading="qcLoading"
            @refresh-qc-choices="refreshQcChoices(true)"
            :loraLoading="loraLoading"
            :loraError="loraError"
            @refresh-comfy-choices="refreshComfyChoices(); refreshQcChoices()"
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
              text size="small" :disabled="deleting || uploading || stopping || persistentChecking" title="取消或放弃旧任务"
              @click="requestManualStop().catch(error => showNodeError(error, '放弃旧任务失败'))">放弃旧任务</el-button>
            <el-button
              class="sendButton"
              :icon="generating ? IconPlayerStop : IconArrowUp"
              :disabled="deleting || uploading || stopping || (!generating && (data.activeGenerationRequest || detachedGenerationId) && (!persistentPhase || persistentChecking || ['failed', 'cancelled', 'abandoned'].includes(persistentPhase))) || (!generating && !data.activeGenerationRequest && !detachedGenerationId && (discoveringRecovery || !generationPrompt || !selectedModel))"
              :title="generating ? '停止生成' : persistentPhase === 'submitting' ? '核对并恢复原任务（不会重新提交）' : data.activeGenerationRequest || detachedGenerationId ? '恢复原视频任务' : '生成视频'"
              :aria-label="generating ? '停止生成' : persistentPhase === 'submitting' ? '核对并恢复原任务（不会重新提交）' : data.activeGenerationRequest || detachedGenerationId ? '恢复原视频任务' : '生成视频'"
              @click="generating ? requestManualStop().catch((error) => showNodeError(error, '取消视频失败')) : startGeneration(true).catch((error) => showNodeError(error, '视频生成失败'))" />
          </div>
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
  <comfyDiagnosisDialog ref="comfyDiagnosis" />
  <videoActions ref="actions" :file="outputFile" :src="previewUrl" :disabled="generating || deleting || uploading" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import { ElButton, ElCard, ElSelect, ElOption, ElOptionGroup, ElLoading, ElDropdown, ElDropdownMenu, ElDropdownItem, ElMessageBox } from "element-plus";
import { IconCameraAi, IconSparkles, IconArrowUp, IconPlayerStop, IconTransfer, IconMusic, IconLayersSubtract, IconScissors, IconPhotoScan, IconPlayerSkipBack, IconPlayerSkipForward } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, useNode, z, h3OptionsSchema, type NodeMediaModel, type NodeVideoRequest, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
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
import comfyDiagnosisDialog from "./components/comfyDiagnosisDialog.vue";

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
const data = computed(() => node.data as { prompt: string; promptZh: string; reviewId?: string; promptModel: PromptModel; model: string; duration?: number; resolution: string; megapixels?: number; upscale?: number; firstPassSteps?: number; secondPassSteps?: number; outputFirstPass: boolean; loraName?: string; manualAccelerationLoras?: string[]; checkpointEvidence?: { model: string; name: string; kind: "standard" | "fused" }; checkpointName?: string; h3Options?: NodeVideoRequest["h3Options"]; qcOverride?: NodeVideoRequest["qcOverride"]; ratio: string; mode: string; generateAudio: boolean; seed: number; seedMode: SeedMode; lastSeed?: number; activeGenerationRequest?: Omit<NodeVideoRequest, "directory">; lastGenerationId?: string });
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
data.value.ratio ??= "16:9";
data.value.seedMode ??= "fixed";
data.value.seed ??= defaultSeed;
const { refList, referenceMentions, setReferencePreview, removeReference } = useNodeReferences();
const models = ref<NodeMediaModel[]>([]);
const loraChoices = ref<string[]>([]);
const checkpointChoices = ref<string[]>([]);
const samplerChoices = ref<string[]>([]);
const schedulerChoices = ref<string[]>([]);
const advancedError = ref("");
type QcChoice = { id: string; label: string; video: boolean; audio: boolean };
type QcDefaults = { qcMethod: "agentFrames" | "model" | "agentFramesAndModel"; qcLevel: "video" | "videoAudio" | "none"; qcTrigger: "auto" | "manual"; videoQcModelId: string; audioQcModelId: string; gemmaQcHost: string };
const qcChoices = ref<QcChoice[]>([]);
const qcDefaults = ref<QcDefaults>();
const qcChoiceError = ref("");
const qcLoading = ref(false);
let qcChoiceRequest = 0;
async function refreshQcChoices(refresh = false) {
  const request = ++qcChoiceRequest;
  qcLoading.value = true;
  qcChoiceError.value = "";
  try {
    const response = await fetch("/api/production/comfyui/qcModels?refresh=" + String(refresh), {
      headers: { "x-toonflow-workspace": "1" }, cache: "no-store", signal: AbortSignal.timeout(12000),
    });
    const result = await response.json() as { code?: number; message?: string; data?: { models: {id:string;label:string;enabled:boolean}[]; languageModels: QcChoice[]; defaults: QcDefaults } };
    if (!response.ok || result.code !== 200 || !result.data) throw new Error(result.message || "读取质检配置失败");
    if (request !== qcChoiceRequest || disposed) return;
    qcDefaults.value = result.data.defaults;
    qcChoices.value = [...result.data.models.filter(item => item.enabled).map(item => ({ id: item.id, label: item.label, video: true, audio: true })), ...result.data.languageModels];
  } catch (error) {
    if (request === qcChoiceRequest && !disposed) qcChoiceError.value = error instanceof Error ? error.message : "质检模型查询失败";
  } finally { if (request === qcChoiceRequest) qcLoading.value = false; }
}
const qcOverrideSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("off") }),
  z.strictObject({ mode: z.literal("custom"), qcMethod: z.enum(["agentFrames","model","agentFramesAndModel"]).optional(),
    qcLevel: z.enum(["video","videoAudio","none"]).optional(), qcTrigger: z.enum(["auto","manual"]).optional(),
    videoQcModelId: z.string().trim().min(1).max(550).regex(/^[^\x00-\x1f]+$/).optional(),
    audioQcModelId: z.string().trim().min(1).max(550).regex(/^[^\x00-\x1f]+$/).optional() }),
]);
const loraLoading = ref(false);
const loraError = ref("");
let choicesController: AbortController | undefined;
let choicesRequest: Promise<void> | undefined;
function refreshComfyChoices() {
  const selected = selectedModel.value;
  if (!selected?.lora) return;
  if (choicesRequest) return choicesRequest;
  const controller = choicesController = new AbortController();
  loraLoading.value = true;
  loraError.value = "";
  loraChoices.value = [];
  checkpointChoices.value = [];
  samplerChoices.value = [];
  schedulerChoices.value = [];
  advancedError.value = "";
  choicesRequest = (async () => {
    try {
      const response = await fetch(`/api/production/comfyui/loras?modelId=${encodeURIComponent(selected.modelId)}`, {
        headers: { "x-toonflow-workspace": "1" },
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json() as { code?: number; message?: string; data?: { names?: string[]; checkpoints?: string[]; samplers?: string[]; schedulers?: string[]; advancedError?: string } };
      if (!response.ok || result.code !== 200 || !Array.isArray(result.data?.names) || !Array.isArray(result.data?.checkpoints)) {
        throw new Error(result.message || "读取已安装视频模型和 LoRA 失败");
      }
      if (controller.signal.aborted) return;
      loraChoices.value = result.data.names;
      checkpointChoices.value = result.data.checkpoints;
      samplerChoices.value = Array.isArray(result.data.samplers) ? result.data.samplers : [];
      schedulerChoices.value = Array.isArray(result.data.schedulers) ? result.data.schedulers : [];
      advancedError.value = result.data.advancedError ?? "";
    } catch (error) {
      if (!controller.signal.aborted) loraError.value = error instanceof Error ? error.message : "ComfyUI 不可用";
    } finally {
      if (choicesController === controller) {
        choicesController = undefined;
        choicesRequest = undefined;
        loraLoading.value = false;
      }
    }
  })();
  return choicesRequest;
}
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
type NodeQcIssue = { id: string; requirementId?: string; domain: string; kind: "defect" | "needsEvidence"; problem: string; expected?: string; observed: string; time?: string; fixHint?: string };
type NodeQcPlan = { summary: string; needsRegeneration: boolean; actions: { issueIds: string[]; category: string; change: string; acceptance: string }[] };
const completedQc = ref<{ path: string; status: string; result?: { status: string; issues?: NodeQcIssue[]; videoModelId?: string; audioModelId?: string }; rectificationPlan?: NodeQcPlan; message?: string }[]>([]);
const currentQc = computed(() => completedQc.value.find(item => item.path === outputFile.value?.url));
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
const comfyDiagnosis = ref<InstanceType<typeof comfyDiagnosisDialog>>();
const persistentChecking = ref(false);
const stopping = ref(false);
const detachedGenerationId = ref("");
const discoveringRecovery = ref(false);

function openComfyDiagnosis() {
  const generationId = data.value.activeGenerationRequest?.generationId || detachedGenerationId.value;
  if (generationId) void comfyDiagnosis.value?.open(generationId);
}
const persistentPhaseLabels: Record<string, string> = {
  preparing: "准备中 · 可以恢复原任务",
  submitting: "提交状态不明 · 点击恢复只核对原任务，绝不重新提交",
  submitted: "已提交 · 可以继续等待或取回原任务",
  saved: "已保存视频 · 可以恢复成片记录",
  completed: "原任务已完成 · 点击恢复结果",
  cancelled: "已取消 · 放弃旧任务后才能新建",
  abandoned: "已放弃 · 可以开始新任务",
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
watch(() => data.value.model, (current, previous) => {
  if (previous && current !== previous && migrateLegacyH3Model(previous) !== current) {
    data.value.loraName = undefined;
    data.value.manualAccelerationLoras = undefined;
    data.value.checkpointName = undefined;
    data.value.h3Options = undefined;
  }
  choicesController?.abort();
  choicesController = undefined;
  choicesRequest = undefined;
  loraLoading.value = false;
  loraChoices.value = [];
  checkpointChoices.value = [];
  samplerChoices.value = [];
  schedulerChoices.value = [];
  advancedError.value = "";
  loraError.value = "";
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
    loraName: choice.lora ? (data.value.loraName ?? choice.lora.defaultName) : undefined,
    checkpointName: choice.checkpoint ? data.value.checkpointName : undefined,
    h3Options: choice.h3Advanced ? data.value.h3Options : undefined,
    qcOverride: data.value.qcOverride,
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
  choicesController?.abort();
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

const unifiedH3WorkflowId = "video/h3_ref2va_dual";
function migrateLegacyH3Model(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== "comfyui") return value;
    if (typeof parsed[1] === "string" &&
      /^(?:video\/h3_erca_(?:16x9|9x16)(?:_autodl)?|video\/h3_ref2va_1080p)$/.test(parsed[1])) {
      return JSON.stringify(["comfyui", unifiedH3WorkflowId]);
    }
  } catch { /* Malformed legacy value remains visible until the user selects a valid workflow. */ }
  return value;
}
function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then((items) => {
    if (disposed || generating.value || deleting.value) return;
    models.value = items.filter((item) => item.type === "video");
    // Deleted H3 workflow IDs migrate only for saved canvases; retain explicit settings.
    const migrated = migrateLegacyH3Model(data.value.model);
    if (migrated !== data.value.model && models.value.some(item => JSON.stringify([item.providerId,item.modelId]) === migrated)) {
      data.value.model = migrated;
    }
    if (!data.value.model) {
      const preferred = models.value.find(item => item.providerId === "comfyui" && item.modelId === unifiedH3WorkflowId);
      const first = preferred ?? models.value[0];
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

async function requestStop(abandon = false) {
  const generationId = data.value.activeGenerationRequest?.generationId || detachedGenerationId.value;
  if (!generationId) {
    generationController?.abort();
    return true;
  }
  const { directory } = await files.getWorkspaceFiles().list();
  const response = await fetch("/api/production/generation/cancel", {
    method: "POST", headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ directory, generationId, ...(abandon ? { abandon: true } : {}) }),
  });
  const result = await response.json();
  if (!response.ok || result.code !== 200) throw new Error(result.message || "无法确认远端任务已停止");
  const phase = String(result.data?.phase ?? "");
  if (phase !== "cancelled" && phase !== "failed" && phase !== "abandoned") {
    // 远端视频可能恰好已保存，保留 generationId 以便找回成片，不能直接忘记任务。
    persistentPhase.value = phase;
    persistentError.value = "视频已保存或任务仍在收尾，请先恢复已有结果";
    return false;
  }
  generationController?.abort();
  data.value.activeGenerationRequest = undefined;
  detachedGenerationId.value = "";
  persistentPhase.value = phase;
  persistentError.value = "";
  return true;
}

async function requestManualStop(remove = false) {
  if (stopping.value) return false;
  const generationId = data.value.activeGenerationRequest?.generationId || detachedGenerationId.value;
  stopping.value = true;
  try {
    try {
      if (await requestStop()) return true;
      // 已保存的结果可以随节点删除，也可以在保留节点时恢复。
      return remove;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "无法确认远端状态";
      const action = remove ? "放弃任务并删除节点" : "放弃旧任务";
      try {
        await ElMessageBox.confirm(`${detail}。放弃会解除本地绑定，远端任务如仍在运行会继续执行。`, action,
          { type: "warning", confirmButtonText: action, cancelButtonText: "返回" });
      } catch (reason) {
        if (reason === "cancel" || reason === "close") return false;
        throw reason;
      }
      if (disposed) return false;
      if ((data.value.activeGenerationRequest?.generationId || detachedGenerationId.value) !== generationId) {
        throw new Error("节点的当前任务已变化，请重新操作");
      }
      return await requestStop(true);
    }
  } finally {
    stopping.value = false;
  }
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
async function resumeDetachedGeneration(manual?: true) {
  const current = data.value.activeGenerationRequest;
  const generationId = detachedGenerationId.value || current?.generationId;
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
        body: JSON.stringify({ directory, generationId, manual }), signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || result.code !== 200) throw new Error(result.message || "无法恢复原任务");
      controller.signal.throwIfAborted();
      const video = result.data?.[0] as { path?: string; mimeType?: string } | undefined;
      if (!video?.path || !video.mimeType) throw new Error("已恢复的任务缺少生成视频");
      if (!disposed) {
        if (current?.seedMode === "random" && current.seed !== undefined) data.value.lastSeed = current.seed;
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
  return { status: "requested", generationId, resumed: true };
}

async function startGeneration(manual?: true, qcModelCallAllowed?: boolean) {
  const current = data.value.activeGenerationRequest;
  const choice = selectedModel.value;
  const input = generationInput.value;
  if (generating.value) throw new Error("视频正在生成，请等待完成");
  if (uploading.value) throw new Error("视频正在替换，请等待完成");
  if (deleting.value) throw new Error("节点正在删除");
  if (stopping.value) throw new Error("正在处理旧任务");
  const localManual = manual && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ? true : undefined;
  if (detachedGenerationId.value || current) return resumeDetachedGeneration(localManual);
  if (!choice || !input) throw new Error("请先选择视频模型");
  if (!generationPrompt.value) throw new Error("请输入生成提示词");
  if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  if (choice.mode?.length && !matchingModes.value.length) throw new Error("当前模型没有适合这些参考素材的生成模式，请更换模型或调整引用");
  const seed = choice.supportsSeed ? resolveSeed() : undefined;
  const request: Omit<NodeVideoRequest, "directory"> = {
    ...input, seed, ...(qcModelCallAllowed === undefined ? {} : { qcModelCallAllowed }), ...(choice.providerId === "comfyui" ? { generationId: crypto.randomUUID() } : {}),
  };
  if (request.generationId) {
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
      return ai.generateVideo({ ...request, directory }, controller.signal, choice.providerId === "comfyui" ? localManual : undefined);
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
  return { status: request.generationId ? "requested" : "generating", seed, generationId: request.generationId, resumed: false };
}

nodeEvent.on("save", (reason) => {
  if (reason === "reload" && (generating.value || uploading.value || deleting.value)) throw new Error("视频处理中，请完成后再刷新节点");
});
nodeEvent.on("delete", async (source) => {
  if (uploading.value) throw new Error("视频正在替换，请稍后删除节点");
  deleting.value = true;
  try {
    if (data.value.activeGenerationRequest || detachedGenerationId.value) {
      if (source === "manual") {
        if (!await requestManualStop(true)) throw new Error("已取消删除");
      } else if (!await requestStop()) throw new Error("请先恢复已保存的成片");
    }
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

// 确认绑定当前工作流与具体权重，切换后不得沿用另一模型的类型。
const checkpointKind = computed<"standard" | "fused" | "unknown">({
  get() {
    const evidence = data.value.checkpointEvidence;
    const name = data.value.checkpointName ?? selectedModel.value?.checkpoint?.defaultName;
    return evidence && evidence.model === data.value.model && evidence.name === name ? evidence.kind : "unknown";
  },
  set(kind) {
    const name = data.value.checkpointName ?? selectedModel.value?.checkpoint?.defaultName;
    data.value.checkpointEvidence = name && kind !== "unknown" ? { model: data.value.model, name, kind } : undefined;
  },
});

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
      loraName: selectedModel.value?.lora ? (data.value.loraName ?? selectedModel.value.lora.defaultName) : undefined,
      checkpointKind: checkpointKind.value,
      manualAccelerationLoras: selectedModel.value?.h3Advanced ? (data.value.manualAccelerationLoras ?? []) : undefined,
      checkpointName: selectedModel.value?.checkpoint ? (data.value.checkpointName ?? selectedModel.value.checkpoint.defaultName) : undefined,
      h3Options: selectedModel.value?.h3Advanced ? data.value.h3Options : undefined,
      ratio: data.value.ratio,
      mode: selectedMode.value,
      generateAudio: data.value.generateAudio,
      supportsSeed: selectedModel.value?.supportsSeed === true,
      seed: selectedModel.value?.supportsSeed ? data.value.seed : undefined,
      seedMode: selectedModel.value?.supportsSeed ? data.value.seedMode : undefined,
      lastSeed: selectedModel.value?.supportsSeed ? data.value.lastSeed : undefined,
    },
    models: models.value,
    loraChoices: loraChoices.value,
    checkpointChoices: checkpointChoices.value,
    samplerChoices: samplerChoices.value,
    schedulerChoices: schedulerChoices.value,
    advancedError: advancedError.value,
    qcOverride: data.value.qcOverride,
    hasPendingGeneration: Boolean(data.value.activeGenerationRequest || detachedGenerationId.value),
    qcDefaults: qcDefaults.value,
    qcChoices: qcChoices.value,
    qcChoiceError: qcChoiceError.value,
    loraError: loraError.value,
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
  // 仅比较会影响原稿、参考和声音的字段。采样调整允许与提示词审核并行。
  const revision = JSON.stringify([selectedModel.value?.promptFormat, input.prompt, data.value.promptZh,
    input.duration, input.ratio, input.mode, input.generateAudio, images, videos, audios, firstFrame, lastFrame]);
  // 随机种子留到实际生成时取值，固定上次随机必须交付具体值供审核绑定。
  const seed = config.supportsSeed && config.seedMode !== "random" ? resolveSeed() : undefined;
  return { config, images, videos, audios, firstFrame, lastFrame, revision, promptZh: data.value.promptZh, request: { ...input, seed } };
}

nodeTools.register({
  name: "getPromptContext",
  description: "读取编写视频提示词所需的实际工作流、生成模式、参数、按生成顺序排列的参考素材，以及写入提示词时需要使用的版本信息。",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    await loadModels();
    signal?.throwIfAborted();
    return getPromptContext();
  },
});

nodeTools.register({
  name: "getConfig",
  description: "读取视频节点的配置、工作流能力、画幅比例及适用的生成模式。manualAccelerationLoras 记录该节点长期保存的手动加速 LoRA 标记，候选文件必须来自已安装的 loraChoices；标记为加速 LoRA 并不代表一定兼容。refreshComfyChoices=true 时，向当前 ComfyUI 查询可用的 checkpointChoices 和 loraChoices，不启动主机。双阶段采样工作流的 sampling 返回百万像素、放大倍率及两个采样阶段的步数。h3Advanced 返回高级设置支持的功能和默认值，samplerChoices 和 schedulerChoices 是远端实际返回的可用选项。qcChoices 返回系统已启用的质检模型；refreshQcChoices=true 时只查询已经安装的模型权重，不启动主机。",
  parameters: z.strictObject({ refreshComfyChoices: z.boolean().optional(), refreshQcChoices: z.boolean().optional() }),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    if (args.refreshComfyChoices) await refreshComfyChoices();
    await refreshQcChoices(args.refreshQcChoices === true);
    signal?.throwIfAborted();
    return getConfig();
  },
});

nodeTools.register({
  name: "setConfig",
  description: "修改视频节点配置。选择工作流时，必须同时提供 providerId 和 modelId。支持更换 H3 权重时，checkpointName 使用 getConfig({refreshComfyChoices:true}) 返回的文件名，传入 null 时恢复工作流的默认值。loraName 为空字符串关闭加速 LoRA。manualAccelerationLoras 可设置手动标记的已安装加速 LoRA 文件名数组（最多32个）；先 getConfig(refreshComfyChoices=true) 获取 loraChoices，标记为加速 LoRA 不代表 PDD、PTD、HyperFlow 等特殊方案可以直接运行。h3Options 用于整体替换可选的高级设置，包括：loraStrength、extraLoras（有序数组，每项 name/strength，最多3个）、sampler、scheduler、videoShift、audioShift；null 恢复高级参数默认值。只使用实际发现的文件和采样选项，不擅自更换已选模型。qcOverride=null 时使用系统默认设置；mode=off 时关闭自动质检；mode=custom 时使用指定的质检策略，模型 ID 从 getConfig.qcChoices 中选择。mode 使用返回的原始字符串或数组，须匹配当前引用。不修改提示词、不启动生成。",
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
    loraName: z.string().max(512).optional(),
    manualAccelerationLoras: z.array(z.string().trim().min(1).max(512).regex(/^[^\x00-\x1f]+$/)).max(32).optional(),
    checkpointName: z.string().trim().min(1).max(512).regex(/^[^\x00-\x1f]+$/).nullable().optional(),
    h3Options: h3OptionsSchema.nullable().optional(),
    qcOverride: qcOverrideSchema.nullable().optional(),
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
    if (args.loraName !== undefined && !choice.lora) throw new Error("当前工作流不支持选择 LoRA");
    if (args.checkpointName !== undefined && !choice.checkpoint) throw new Error("当前工作流不支持更换视频模型权重");
    if (args.h3Options != null && !choice.h3Advanced) throw new Error("当前工作流不支持高级采样或多 LoRA");
    if (args.manualAccelerationLoras !== undefined) {
      if (!choice.h3Advanced) throw new Error("当前工作流不支持手动标记加速 LoRA");
      if (args.manualAccelerationLoras.length) {
        if (selectedModel.value?.modelId !== choice.modelId || selectedModel.value?.providerId !== choice.providerId) {
          throw new Error("请先切换到目标视频工作流，再读取该工作流的已安装 LoRA 列表进行手动标记");
        }
        await refreshComfyChoices();
        signal?.throwIfAborted();
        if (generating.value || deleting.value) throw new Error("节点状态已变化，请重新读取配置");
        if (loraError.value) throw new Error(loraError.value);
      }
      const canonical = (value: string) => value.replaceAll("\\", "/").toLowerCase();
      const requested = args.manualAccelerationLoras.map(canonical);
      if (new Set(requested).size !== requested.length) throw new Error("手动加速 LoRA 不能重复");
      for (const name of requested) {
        if (!loraChoices.value.some(item => canonical(item) === name)) {
          throw new Error("手动标记的加速 LoRA 不在当前 ComfyUI 已安装列表中，请重新读取模型列表");
        }
      }
    }
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
    if (args.qcOverride?.mode === "custom") {
      await refreshQcChoices();
      signal?.throwIfAborted();
      if (generating.value || deleting.value) throw new Error("节点状态已变化，请重新读取配置");
      if (qcChoiceError.value) throw new Error(qcChoiceError.value);
      for (const [key, capability] of [["videoQcModelId", "video"], ["audioQcModelId", "audio"]] as const) {
        const id = args.qcOverride[key];
        if (id !== undefined && !qcChoices.value.some(item => item.id === id && item[capability])) throw new Error(`质检模型 ${id} 未启用或不支持对应输入，请从 getConfig.qcChoices 选择`);
      }
    }
    const sameModel = data.value.model === JSON.stringify([choice.providerId, choice.modelId]);
    const nextLora = args.loraName ?? (sameModel ? data.value.loraName : undefined) ?? choice.lora?.defaultName;
    const nextAdvanced = args.h3Options === null ? undefined : args.h3Options ?? (sameModel ? data.value.h3Options : undefined);
    if (nextAdvanced?.loraStrength !== undefined && nextLora === "" && args.h3Options != null) throw new Error("关闭主 LoRA 时不能指定主 LoRA 强度");
    if (nextLora && nextAdvanced?.extraLoras?.some(item => item.name.replaceAll("\\", "/") === nextLora.replaceAll("\\", "/"))) throw new Error("主 LoRA 与附加 LoRA 不能重复");
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
    if (args.loraName !== undefined) data.value.loraName = args.loraName;
    if (args.manualAccelerationLoras !== undefined) data.value.manualAccelerationLoras = [...args.manualAccelerationLoras];
    else if (!sameModel) data.value.manualAccelerationLoras = undefined;
    if (args.checkpointName !== undefined) data.value.checkpointName = args.checkpointName ?? undefined;
    if (args.h3Options !== undefined) data.value.h3Options = args.h3Options ?? undefined;
    if (args.loraName === "" && data.value.h3Options?.loraStrength !== undefined) {
      const { loraStrength: _strength, ...rest } = data.value.h3Options;
      data.value.h3Options = Object.keys(rest).length ? rest : undefined;
    }
    if (args.qcOverride !== undefined) data.value.qcOverride = args.qcOverride ?? undefined;
    if (args.seedMode !== undefined) data.value.seedMode = args.seedMode;
    if (args.seed !== undefined) data.value.seed = args.seed;
    return getConfig();
  },
});

nodeTools.register({
  name: "setPrompt",
  description: "写入视频模型实际收到的 prompt。按所选工作流的语言、格式和参考编号填写。使用 H3 时，根据对应生成模式的格式编写英文正文，按照定稿保留对白、歌词及画面文字的原文。promptZh 提供简体中文对照，便于审阅；生成模型只接收 prompt。H3 的 reviewId 取自已通过的提示词审核，服务端按实际请求校验。本工具只写入提示词。",
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
  description: "查询此节点正在执行或最近已完成任务的成片及 videoQc。awaitingAgent 表示当前主 Agent 还需要调用 getVideoQcFrames 查看实际画面，再通过 submitVideoQc 逐项提交验收结论，不能视为验收已经完成。不启动生成或质检。",
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
  description: "返回 requested 表示节点已经发起或恢复本地请求。使用 getPersistentGenerationStatus 查询相同的 generationId；只有 phase 为 submitted、saved 或 completed，且存在 promptId 时，才能确认 ComfyUI 已经接收任务。preparing 和 submitting 表示尚未确认接收，failed 表示任务失败，需要读取 error 中的具体错误。刷新后只恢复原任务，需要明确停止时使用 cancelPersistentGeneration。",
  parameters: z.strictObject({ qcModelCallAllowed: z.boolean().optional() }),
  execute(args, { signal }) {
    signal?.throwIfAborted();
    return startGeneration(undefined, args.qcModelCallAllowed);
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
  .qcProblemPanel {
    margin: 0 0 10px;
    padding: 8px 10px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 9px;
    background: var(--el-fill-color-extra-light);
    summary { font-size: 12px; font-weight: 650; cursor: pointer; color: var(--el-text-color-primary); }
    p { font-size: 12px; line-height: 1.6; }
    ol { margin: 8px 0 0; padding-left: 21px; }
    li { margin-bottom: 8px; font-size: 11px; line-height: 1.5; color: var(--el-text-color-regular); }
    li strong, li span, li small { display: block; }
    li strong { color: var(--el-text-color-primary); }
    li small { color: var(--el-text-color-secondary); }
    > small { color: var(--el-text-color-placeholder); }
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
