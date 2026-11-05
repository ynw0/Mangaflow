<template>
  <div class="workflow">
    <header class="pageHeader">
      <div>
        <h3>制作配置</h3>
        <p>配置从素材生成到成片验收的工作流与运行环境。</p>
      </div>
      <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
    </header>

    <div v-if="workflowNotices.length" class="workflowNotices" role="status">
      <el-text v-for="notice in workflowNotices" :key="notice" type="warning">{{ notice }}</el-text>
    </div>

    <section class="settingGroup" aria-labelledby="generationTitle">
      <header class="groupHeader">
        <span class="groupNumber" aria-hidden="true">01</span>
        <h3 id="generationTitle">素材与成片</h3>
      </header>
      <div class="generationGrid">
        <section class="settingCard" aria-labelledby="imageTitle">
          <header class="cardHeader">
            <h4 id="imageTitle">出图</h4>
            <p>设置出图方式、后端和默认模型。</p>
          </header>
          <div class="fieldGrid">
            <div class="field">
              <label for="workflowImageAdvance">出图方式</label>
              <el-select id="workflowImageAdvance" v-model="imageAdvanceMode">
                <el-option label="半自动" value="semi" />
                <el-option label="自动" value="auto" />
              </el-select>
            </div>
            <div class="field">
              <label for="workflowImageSource">出图后端</label>
              <el-select id="workflowImageSource" v-model="imageSource">
                <el-option label="Qwen 图像 API" value="qwen" />
                <el-option label="ComfyUI 工作流" value="comfyui" />
              </el-select>
            </div>
          </div>
          <p class="hint">半自动在出图遇到问题时询问。自动会检查并重试当前图片，视频生成另行确认。</p>
          <div v-if="imageSource === 'qwen'" class="field">
            <label for="workflowImageModel">图像模型</label>
            <el-select id="workflowImageModel" v-model="imageModelKey" placeholder="选择 Qwen 图像模型">
              <el-option v-for="item in qwenModels" :key="item.key" :label="`${item.label} · ${item.providerLabel}`" :value="item.key" />
            </el-select>
            <el-text v-if="!qwenModels.length" type="warning" role="status">媒体模型中暂无可用的 Qwen 图像模型。</el-text>
          </div>
          <template v-else>
            <div class="fieldGrid">
              <div class="field">
                <label for="workflowImageT2i">无参考图</label>
                <el-select id="workflowImageT2i" v-model="imageT2iWorkflow" placeholder="选择文生图工作流">
                  <el-option v-for="item in textImageWorkflows" :key="item.id" :label="item.label" :value="item.id" />
                </el-select>
              </div>
              <div class="field">
                <label for="workflowImageEdit">有参考图</label>
                <el-select id="workflowImageEdit" v-model="imageEditWorkflow" placeholder="选择图像编辑工作流">
                  <el-option v-for="item in editImageWorkflows" :key="item.id" :label="item.label" :value="item.id" />
                </el-select>
              </div>
            </div>
            <workflowCatalog title="图像工作流" :items="imageWorkflows" :disabledIds="disabledWorkflowIds" :switchKey="workflowSwitchKey" @change="setWorkflowOn" />
          </template>
          <details class="assetSizes">
            <summary>素材规格</summary>
            <dl>
              <dt>角色设定</dt><dd>2048×768，面部特写加正侧背</dd>
              <dt>场景拼版</dt><dd>1024×1024，换机位或重复使用时用四方向</dd>
              <dt>氛围空镜</dt><dd>1344×768，无人场景或转场</dd>
              <dt>道具原画</dt><dd>768×1024、1024×1024 或 1344×768</dd>
            </dl>
          </details>
        </section>

        <section class="settingCard" aria-labelledby="videoTitle">
          <header class="cardHeader">
            <h4 id="videoTitle">出视频</h4>
            <p>每个视频节点生成一个连续镜头。</p>
          </header>
          <div class="field">
            <label for="workflowVideoSource">出视频后端</label>
            <el-select id="workflowVideoSource" v-model="videoProviderId">
              <el-option label="ComfyUI 工作流" value="comfyui" />
              <el-option label="云视频 · Wan3.0" value="videoModel" />
            </el-select>
          </div>
          <template v-if="videoProviderId === 'comfyui'">
            <div class="field">
              <label for="workflowVideoDefault">默认视频工作流</label>
              <el-select id="workflowVideoDefault" v-model="videoWorkflow" placeholder="选择视频工作流">
                <el-option v-for="item in enabledMainVideoWorkflows" :key="item.id" :label="item.label" :value="item.id" />
              </el-select>
            </div>
            <workflowCatalog title="视频工作流" :items="videoWorkflows" :disabledIds="disabledWorkflowIds" :switchKey="workflowSwitchKey" @change="setWorkflowOn" />
            <p v-if="repairWorkflow" class="hint">首尾帧修复使用 {{ repairWorkflow.label }}。</p>
          </template>
          <p v-else class="hint">在「模型 → 视频模型」配置云视频 API 地址与密钥。</p>
        </section>
      </div>
    </section>

    <section class="settingGroup" aria-labelledby="qcTitle">
      <header class="groupHeader">
        <span class="groupNumber" aria-hidden="true">02</span>
        <h3 id="qcTitle">成片质检</h3>
      </header>
      <div class="settingCard">
        <div class="fieldGrid">
          <div class="field">
            <label for="workflowQcLevel">质检范围</label>
            <el-select id="workflowQcLevel" v-model="qcLevel">
              <el-option label="只视频" value="video" />
              <el-option label="视频 + 音频" value="videoAudio" />
              <el-option label="人工质检" value="none" />
            </el-select>
          </div>
          <div class="field">
            <label for="workflowQcTrigger">触发方式</label>
            <el-select id="workflowQcTrigger" v-model="qcTrigger" :disabled="qcLevel === 'none'">
              <el-option label="自动 · 出片后质检" value="auto" />
              <el-option label="手动 · 按需质检" value="manual" />
            </el-select>
          </div>
        </div>
        <template v-if="qcLevel !== 'none'">
          <div class="fieldGrid">
            <div class="field">
              <label for="workflowVideoQc">画面模型</label>
              <el-select id="workflowVideoQc" v-model="videoQcModelId" filterable teleported fitInputWidth popperClass="qcModelPopper" placeholder="选择质检模型" @change="onVideoQcModel">
                <el-option-group v-if="enabledQcWorkflows.length" label="质检工作流">
                  <el-option v-for="item in enabledQcWorkflows" :key="item.id" :label="item.label" :value="item.id" />
                </el-option-group>
                <el-option-group label="语言模型">
                  <el-option v-for="item in languageVideoQcChoices" :key="`v-${item.providerId}-${item.modelId}`" :label="item.label" :value="item.modelId" />
                </el-option-group>
              </el-select>
            </div>
            <div v-if="qcLevel === 'videoAudio'" class="field">
              <label for="workflowAudioQc">音轨模型</label>
              <el-select id="workflowAudioQc" v-model="audioQcModelId" filterable teleported fitInputWidth popperClass="qcModelPopper" placeholder="选择可听音频的模型" @change="onAudioQcModel">
                <el-option-group v-if="enabledQcWorkflows.length" label="质检工作流">
                  <el-option v-for="item in enabledQcWorkflows" :key="item.id" :label="item.label" :value="item.id" />
                </el-option-group>
                <el-option-group label="语言模型">
                  <el-option v-for="item in audioQcChoices" :key="`a-${item.providerId}-${item.modelId}`" :label="item.label" :value="item.modelId" />
                </el-option-group>
              </el-select>
            </div>
          </div>
          <el-text v-if="!languageModels.length && !enabledQcWorkflows.length" type="warning" role="status">暂无可用的质检工作流或语言模型。</el-text>
          <el-text v-else-if="videoQcModelId && !videoQcModels.some(item => item.modelId === videoQcModelId)" type="warning" role="status">当前画面质检模型不可用。</el-text>
          <el-text v-else-if="qcLevel === 'videoAudio' && audioQcModelId && !audioQcModels.some(item => item.modelId === audioQcModelId)" type="warning" role="status">当前音轨质检模型不可用。</el-text>
          <el-text v-else-if="qcLevel === 'videoAudio' && !usesGemmaQc && audioQcModelId && !audioCapableModels.some(item => item.modelId === audioQcModelId)" type="warning" role="status">当前音轨质检模型未勾选音频输入。</el-text>
          <div v-if="usesGemmaQc" class="gemmaHost">
            <div class="field">
              <label for="workflowGemmaHost">Gemma 运行位置</label>
              <el-select id="workflowGemmaHost" v-model="gemmaQcHost">
                <el-option label="本机 ComfyUI" value="local" />
                <el-option label="AutoDL 上的 ComfyUI" value="autodl" />
              </el-select>
            </div>
            <p class="hint">
              {{ gemmaQcHost === 'autodl' ? '整段成片会上传到下方配置的 AutoDL 实例。' : '使用下方配置的本机 ComfyUI。' }}
              {{ qcLevel === 'videoAudio' ? '同一次 Gemma 调用检查画面与音轨。' : '本次只检查画面。' }}
            </p>
          </div>
        </template>
        <workflowCatalog title="质检工作流" :items="qcWorkflows" :disabledIds="disabledWorkflowIds" :switchKey="workflowSwitchKey" @change="setWorkflowOn" />
      </div>
    </section>

    <section v-if="usesLocal || usesAutodl" class="settingGroup" aria-labelledby="comfyTitle">
      <header class="groupHeader">
        <span class="groupNumber" aria-hidden="true">03</span>
        <h3 id="comfyTitle">运行环境</h3>
      </header>
      <div class="settingCard">
        <div v-if="usesComfy" class="field">
          <label for="workflowGenerationHost">生成所用的 ComfyUI</label>
          <el-select id="workflowGenerationHost" v-model="videoHost">
            <el-option label="AutoDL 上的 ComfyUI" value="autodl" />
            <el-option label="本机 ComfyUI" value="local" />
          </el-select>
        </div>
        <section v-if="usesLocal" class="connectionBlock" aria-labelledby="workflowLocalTitle">
          <header class="cardHeader">
            <h4 id="workflowLocalTitle">本机 ComfyUI</h4>
            <p>连接已经启动的本机服务。</p>
          </header>
          <div class="field">
            <label for="workflowLocalAddress">服务地址</label>
            <div class="controlRow">
              <el-input id="workflowLocalAddress" v-model="localComfyuiBaseUrl" placeholder="http://127.0.0.1:8188" />
              <el-button :loading="probing === 'local'" :disabled="probing === 'autodl'" @click="probe('local')">探测连接</el-button>
            </div>
          </div>
          <el-text v-if="probeResult?.host === 'local'" :type="probeResult.ok ? 'success' : 'danger'" role="status">{{ probeResult.message }}</el-text>
        </section>
        <section v-if="usesAutodl" class="connectionBlock" aria-labelledby="workflowAutodlTitle">
          <header class="connectionHeader">
            <div class="cardHeader">
              <h4 id="workflowAutodlTitle">AutoDL</h4>
              <p>同一实例可用于生成和 Gemma 质检。</p>
            </div>
            <div class="switchField">
              <label for="workflowAutodlBoot">任务前检查开机</label>
              <el-switch id="workflowAutodlBoot" v-model="autodlEnsureRunning" aria-label="任务前检查开机" />
            </div>
          </header>
          <div class="fieldGrid">
            <div class="field">
              <label for="workflowAutodlUrl">平台地址</label>
              <el-input id="workflowAutodlUrl" v-model="autodlBaseUrl" />
            </div>
            <div class="field">
              <label for="workflowAutodlToken">开发者 Token</label>
              <el-input id="workflowAutodlToken" v-model="autodlToken" type="password" showPassword />
            </div>
          </div>
          <div class="field">
            <label for="workflowAutodlInstance">实例</label>
            <div class="controlRow">
              <el-select id="workflowAutodlInstance" v-model="autodlInstanceUuid" filterable allowCreate defaultFirstOption placeholder="选择实例或输入 UUID">
                <el-option v-for="item in instances" :key="item.uuid" :label="`${item.name || item.uuid} · ${item.status}`" :value="item.uuid" />
              </el-select>
              <el-button :loading="loadingInstances" @click="loadInstances">读取实例</el-button>
            </div>
          </div>
          <div class="field">
            <label for="workflowAutodlCommand">开机命令</label>
            <el-input id="workflowAutodlCommand" v-model="autodlStartCommand" placeholder="可选" />
          </div>
          <div class="fieldGrid">
            <div class="field">
              <label for="workflowServiceField">实例服务字段</label>
              <el-input id="workflowServiceField" v-model="comfyuiServiceField" placeholder="service_6006_domain" />
            </div>
            <div class="field">
              <label for="workflowServiceProtocol">访问协议</label>
              <el-select id="workflowServiceProtocol" v-model="comfyuiScheme">
                <el-option label="HTTPS" value="https" />
                <el-option label="HTTP" value="http" />
              </el-select>
            </div>
          </div>
          <div class="field">
            <label for="workflowAutodlComfy">手动 ComfyUI 地址</label>
            <el-input id="workflowAutodlComfy" v-model="comfyuiBaseUrl" placeholder="留空则从实例获取服务地址" />
          </div>
          <div class="connectionActions">
            <el-button :loading="probing === 'autodl'" :disabled="probing === 'local'" @click="probe('autodl')">开机并探测</el-button>
            <el-button :loading="checking" @click="checkStatus">查状态</el-button>
            <el-button :loading="powering" @click="power('on')">开机</el-button>
            <el-button :loading="powering" @click="power('off')">关机</el-button>
            <el-tag v-if="statusMessage" effect="plain" role="status">{{ statusMessage }}</el-tag>
          </div>
          <el-text v-if="probeResult?.host === 'autodl'" :type="probeResult.ok ? 'success' : 'danger'" role="status">{{ probeResult.message }}</el-text>
        </section>
      </div>
    </section>

    <section v-if="usesLocal || usesAutodl" class="settingGroup" aria-labelledby="catalogTitle">
      <header class="groupHeader">
        <span class="groupNumber" aria-hidden="true">04</span>
        <h3 id="catalogTitle">工作流管理</h3>
      </header>
      <div class="settingCard">
        <div class="field">
          <label for="workflowDirectory">额外工作流目录</label>
          <el-input id="workflowDirectory" v-model="workflowRoot" placeholder="例如 E:\Manga\pipeline\workflows" />
          <p class="hint">按 image、video、qc 分类追加到内置目录。</p>
        </div>
        <section class="connectionBlock" aria-labelledby="uploadTitle">
          <header class="cardHeader">
            <h4 id="uploadTitle">上传 API 工作流</h4>
            <p>导入 ComfyUI 导出的 API JSON。校验通过后保存到用户工作流目录。</p>
          </header>
          <div class="fieldGrid">
            <div class="field">
              <label for="workflowUploadId">工作流 ID</label>
              <el-input id="workflowUploadId" v-model="uploadId" placeholder="例如 video/my_h3" />
            </div>
            <div class="field">
              <label for="workflowUploadLabel">显示名称</label>
              <el-input id="workflowUploadLabel" v-model="uploadLabel" placeholder="可选" />
            </div>
          </div>
          <div class="connectionActions">
            <input ref="uploadInput" type="file" accept="application/json,.json" hidden @change="onUploadFile" />
            <el-button :loading="uploading" :disabled="!uploadId.trim()" @click="pickUpload">选择并上传 JSON</el-button>
            <el-text v-if="uploadMessage" :type="uploadOk ? 'success' : 'danger'" role="status">{{ uploadMessage }}</el-text>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { mediaProviders } from "@toonflow/providers";
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { modelChoices, saveSettings, settings } from "@/stores/settings";
import workflowCatalog from "./workflowCatalog.vue";

type ComfyHost = "local" | "autodl";
type WorkflowItem = { id: string; label: string; usage?: string; imageReferences?: { min: number; max: number } };
type InstanceItem = { uuid: string; name: string; status: string };
type QwenModel = { key: string; label: string; providerLabel: string };

const headers = { "x-toonflow-workspace": "1" };
const comfyuiBaseUrl = ref("");
const comfyuiServiceField = ref("service_6006_domain");
const comfyuiScheme = ref("https");
const workflowRoot = ref("");
const imageSource = ref<"qwen" | "comfyui">("qwen");
const imageProviderId = ref("qwenImage");
const imageModelId = ref("qwen-image-3.0-pro");
const imageT2iWorkflow = ref("image/flux3KleinT2i");
const imageEditWorkflow = ref("image/flux3KleinDistilledEdit");
const disabledWorkflowIds = ref<string[]>([]);
const workflowSwitchKey = ref(0);
const videoProviderId = ref<"comfyui" | "videoModel">("comfyui");
const videoHost = ref<ComfyHost>("autodl");
const gemmaQcHost = ref<ComfyHost>("local");
const localComfyuiBaseUrl = ref("http://127.0.0.1:8188");
const videoWorkflow = ref("video/h3_ref2va_1080p");
const videoQcModelId = ref("qwen3.8-omni-flash");
const audioQcModelId = ref("qwen3.8-omni-flash");
const qcLevel = ref<"video" | "videoAudio" | "none">("videoAudio");
const qcTrigger = ref<"auto" | "manual">("manual");
const imageAdvanceMode = ref<"auto" | "semi">("semi");
const qwenModels = ref<QwenModel[]>([]);
const autodlBaseUrl = ref("https://www.autodl.art");
const autodlToken = ref("");
const autodlInstanceUuid = ref("");
const autodlStartCommand = ref("");
const autodlEnsureRunning = ref(false);
const workflowNotices = ref<string[]>([]);
const imageWorkflows = ref<WorkflowItem[]>([]);
const videoWorkflows = ref<WorkflowItem[]>([]);
const qcWorkflows = ref<WorkflowItem[]>([]);
const instances = ref<InstanceItem[]>([]);
const probing = ref<ComfyHost>();
const probeResult = ref<{ host: ComfyHost; ok: boolean; message: string }>();
const loadingInstances = ref(false);
const powering = ref(false);
const checking = ref(false);
const statusMessage = ref("");
const saving = ref(false);
const uploadId = ref("");
const uploadLabel = ref("");
const uploading = ref(false);
const uploadOk = ref(false);
const uploadMessage = ref("");
const uploadInput = ref<HTMLInputElement>();
const imageModelKey = computed({
  get: () => imageProviderId.value && imageModelId.value ? JSON.stringify([imageProviderId.value, imageModelId.value]) : "",
  set: (value: string) => {
    if (!value) {
      imageProviderId.value = "";
      imageModelId.value = "";
      return;
    }
    const parsed = JSON.parse(value) as unknown;
    const pair = Array.isArray(parsed) ? parsed : [];
    imageProviderId.value = typeof pair[0] === "string" ? pair[0] : "";
    imageModelId.value = typeof pair[1] === "string" ? pair[1] : "";
  },
});
const usesComfy = computed(() => imageSource.value === "comfyui" || videoProviderId.value === "comfyui");
const mainVideoWorkflows = computed(() => videoWorkflows.value.filter(item => item.id !== "video/h3_flf_repair"));
const enabledImageWorkflows = computed(() => imageWorkflows.value.filter(item => workflowOn(item.id)));
const textImageWorkflows = computed(() => enabledImageWorkflows.value.filter(item => item.imageReferences?.min === 0));
const editImageWorkflows = computed(() => enabledImageWorkflows.value.filter(item => (item.imageReferences?.max ?? 0) > 0));
const enabledMainVideoWorkflows = computed(() => mainVideoWorkflows.value.filter(item => workflowOn(item.id)));
const enabledQcWorkflows = computed(() => qcWorkflows.value.filter(item => workflowOn(item.id)));
const repairWorkflow = computed(() => videoWorkflows.value.find(item => item.id === "video/h3_flf_repair"));
const languageModels = computed(() => modelChoices.value);
const gemmaVideoQc = computed(() => isGemmaQc(videoQcModelId.value));
const gemmaAudioQc = computed(() => isGemmaQc(audioQcModelId.value));
const usesGemmaQc = computed(() => qcLevel.value !== "none" && (gemmaVideoQc.value || (qcLevel.value === "videoAudio" && gemmaAudioQc.value)));
const usesLocal = computed(() => (usesComfy.value && videoHost.value === "local") || (usesGemmaQc.value && gemmaQcHost.value === "local"));
const usesAutodl = computed(() => (usesComfy.value && videoHost.value === "autodl") || (usesGemmaQc.value && gemmaQcHost.value === "autodl"));
const audioCapableModels = computed(() => languageModels.value.filter(item => item.inputs.audio));
const languageVideoQcChoices = computed(() => qcModelChoices(languageModels.value, videoQcModelId.value));
const audioQcChoices = computed(() => qcModelChoices(languageModels.value, audioQcModelId.value));
const videoQcModels = computed(() => [
  ...enabledQcWorkflows.value.map(item => ({ providerId: "comfyui", modelId: item.id, label: item.label })),
  ...languageVideoQcChoices.value,
]);
const audioQcModels = computed(() => [
  ...enabledQcWorkflows.value.map(item => ({ providerId: "comfyui", modelId: item.id, label: item.label })),
  ...audioQcChoices.value,
]);

function isGemmaQc(value: string) {
  return /^qc\/gemma4/i.test(value.trim());
}

// Gemma 一条工作流同时看画面和听对白，两个下拉保持同一条。
function onVideoQcModel(value: string) {
  if (isGemmaQc(value)) {
    if (qcLevel.value === "videoAudio") audioQcModelId.value = value;
    return;
  }
  if (isGemmaQc(audioQcModelId.value)) audioQcModelId.value = "qwen3.8-omni-flash";
}

function onAudioQcModel(value: string) {
  if (isGemmaQc(value)) videoQcModelId.value = value;
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

// 语言模型全部可选。默认质检模型和当前已保存、但不在列表里的 id 也放进选项，否则下拉里看得到却点不中。
function qcModelChoices(models: { providerId: string; modelId: string; label: string }[], currentId: string) {
  const items = models.map(item => ({
    providerId: item.providerId,
    modelId: item.modelId,
    label: item.label && item.label !== item.modelId ? `${item.label} · ${item.modelId}` : item.modelId,
  }));
  for (const id of [currentId.trim(), "qwen3.8-omni-flash"]) {
    if (id && !id.startsWith("qc/") && !items.some(item => item.modelId === id)) items.push({ providerId: "", modelId: id, label: id });
  }
  return items;
}

function workflowOn(id: string) {
  return !disabledWorkflowIds.value.includes(id);
}

// 关闭后画布或质检下拉不再列出；当前默认工作流和当前画面质检保持开启。
function setWorkflowOn(id: string, value: unknown) {
  const on = value === true;
  const currentQc = id === videoQcModelId.value.trim() || id === audioQcModelId.value.trim();
  if (!on && (id === imageT2iWorkflow.value || id === imageEditWorkflow.value || id === videoWorkflow.value || currentQc)) {
    workflowSwitchKey.value += 1;
    ElMessage.warning(currentQc ? "这是当前质检，请先改选再关闭" : "这是当前默认工作流，请先改选默认再关闭");
    return;
  }
  const next = new Set(disabledWorkflowIds.value);
  if (on) next.delete(id);
  else next.add(id);
  disabledWorkflowIds.value = [...next];
}

function readForm() {
  const current = settings.value.production;
  const source = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  const savedUrl = text(source.comfyuiBaseUrl, "");
  comfyuiBaseUrl.value = savedUrl === "http://127.0.0.1:8188" || savedUrl === "http://localhost:8188" ? "" : savedUrl;
  comfyuiServiceField.value = text(source.comfyuiServiceField, "service_6006_domain");
  comfyuiScheme.value = text(source.comfyuiScheme, "https") === "http" ? "http" : "https";
  workflowRoot.value = text(source.workflowRoot, "");
  imageSource.value = source.imageSource === "comfyui" ? "comfyui" : "qwen";
  imageProviderId.value = text(source.imageProviderId, "") || "qwenImage";
  imageModelId.value = text(source.imageModelId, "") || "qwen-image-3.0-pro";
  const savedT2i = text(source.imageT2iWorkflow, "");
  imageT2iWorkflow.value = savedT2i || "image/flux3KleinT2i";
  imageEditWorkflow.value = text(source.imageEditWorkflow, "") || "image/flux3KleinDistilledEdit";
  disabledWorkflowIds.value = Array.isArray(source.disabledWorkflowIds)
    ? [...new Set(source.disabledWorkflowIds.filter((item): item is string => typeof item === "string"))]
    : [];
  videoProviderId.value = source.videoProviderId === "videoModel" ? "videoModel" : "comfyui";
  videoHost.value = source.videoHost === "local" ? "local" : "autodl";
  gemmaQcHost.value = source.gemmaQcHost === "autodl" ? "autodl" : "local";
  localComfyuiBaseUrl.value = text(source.localComfyuiBaseUrl, "") || "http://127.0.0.1:8188";
  videoWorkflow.value = text(source.videoWorkflow, "") || "video/h3_ref2va_1080p";
  videoQcModelId.value = text(source.videoQcModelId, "") || "qwen3.8-omni-flash";
  audioQcModelId.value = text(source.audioQcModelId, "") || "qwen3.8-omni-flash";
  qcLevel.value = source.qcLevel === "video" || source.qcLevel === "none" ? source.qcLevel : "videoAudio";
  qcTrigger.value = source.qcTrigger === "auto" ? "auto" : "manual";
  imageAdvanceMode.value = source.imageAdvanceMode === "auto" ? "auto" : "semi";
  autodlBaseUrl.value = text(source.autodlBaseUrl, "https://www.autodl.art");
  autodlToken.value = text(source.autodlToken, "");
  autodlInstanceUuid.value = text(source.autodlInstanceUuid, "");
  autodlStartCommand.value = text(source.autodlStartCommand, "");
  autodlEnsureRunning.value = source.autodlEnsureRunning === undefined ? true : source.autodlEnsureRunning === true;
}

function productionPatch() {
  return {
    comfyuiBaseUrl: comfyuiBaseUrl.value.trim(),
    comfyuiServiceField: comfyuiServiceField.value.trim() || "service_6006_domain",
    comfyuiScheme: comfyuiScheme.value,
    workflowRoot: workflowRoot.value.trim(),
    imageSource: imageSource.value === "comfyui" ? "comfyui" : "qwen",
    imageProviderId: imageProviderId.value.trim() || "qwenImage",
    imageModelId: imageModelId.value.trim() || "qwen-image-3.0-pro",
    imageT2iWorkflow: imageT2iWorkflow.value.trim() || "image/flux3KleinT2i",
    imageEditWorkflow: imageEditWorkflow.value.trim() || "image/flux3KleinDistilledEdit",
    disabledWorkflowIds: disabledWorkflowIds.value,
    videoProviderId: videoProviderId.value === "videoModel" ? "videoModel" : "comfyui",
    videoHost: videoHost.value,
    gemmaQcHost: gemmaQcHost.value,
    localComfyuiBaseUrl: localComfyuiBaseUrl.value.trim() || "http://127.0.0.1:8188",
    videoWorkflow: videoWorkflow.value.trim() || "video/h3_ref2va_1080p",
    videoQcModelId: videoQcModelId.value.trim() || "qwen3.8-omni-flash",
    audioQcModelId: audioQcModelId.value.trim() || "qwen3.8-omni-flash",
    qcLevel: qcLevel.value,
    qcTrigger: qcLevel.value === "none" ? "manual" : qcTrigger.value,
    imageAdvanceMode: imageAdvanceMode.value,
    autodlBaseUrl: autodlBaseUrl.value.trim(),
    autodlToken: autodlToken.value.trim(),
    autodlInstanceUuid: autodlInstanceUuid.value.trim(),
    autodlStartCommand: autodlStartCommand.value.trim(),
    autodlEnsureRunning: autodlEnsureRunning.value,
  };
}

async function save() {
  saving.value = true;
  try {
    await saveSettings(() => ({ production: productionPatch() }));
    window.dispatchEvent(new Event("toonflow:provider-config-changed"));
    await loadWorkflows();
    ElMessage.success("工作流配置已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

function pickUpload() {
  uploadInput.value?.click();
}

async function onUploadFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const id = uploadId.value.trim();
  if (!id) {
    ElMessage.error("请先填写工作流 id");
    return;
  }
  uploading.value = true;
  uploadMessage.value = "";
  uploadOk.value = false;
  try {
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("请选择非空且不超过 20 MB 的 JSON 文件");
    const apiJson = JSON.parse((await file.text()).replace(/^\uFEFF/, "")) as unknown;
    const model = modelChoices.value[0];
    const { data } = await axios.post<{ code: number; data?: { id: string; label: string }; message?: string }>(
      "/api/production/workflows/upload",
      {
        id,
        label: uploadLabel.value.trim() || undefined,
        apiJson,
        ...(model ? { providerId: model.providerId, modelId: model.modelId } : {}),
      },
      { headers, timeout: 5 * 60_000 },
    );
    if (data.code !== 200 || !data.data) throw new Error(data.message || "上传失败");
    await loadWorkflows();
    videoWorkflow.value = data.data.id;
    uploadOk.value = true;
    uploadMessage.value = `已上传 ${data.data.label}（${data.data.id}），可设为默认视频工作流`;
    ElMessage.success(uploadMessage.value);
  } catch (error) {
    uploadOk.value = false;
    uploadMessage.value = axios.isAxiosError(error)
      ? error.response?.data?.message || error.message || "上传失败"
      : error instanceof Error ? error.message : "上传失败";
    ElMessage.error(uploadMessage.value);
  } finally {
    uploading.value = false;
  }
}

async function loadWorkflows() {
  const { data } = await axios.get<{ code: number; data: { image: WorkflowItem[]; video: WorkflowItem[]; qc: WorkflowItem[]; notices?: string[] }; message?: string }>("/api/production/workflows", { headers });
  if (data.code !== 200) throw new Error(data.message || "读取工作流失败");
  workflowNotices.value = Array.isArray(data.data.notices) ? data.data.notices.filter(item => typeof item === "string") : [];
  imageWorkflows.value = data.data.image;
  videoWorkflows.value = data.data.video;
  qcWorkflows.value = data.data.qc;
  const selectable = data.data.video.filter(item => item.id !== "video/h3_flf_repair" && workflowOn(item.id));
  if (selectable.length && !selectable.some(item => item.id === videoWorkflow.value)) videoWorkflow.value = selectable[0]?.id || videoWorkflow.value;
}

function qwenModelList(items: { providerId: string; providerLabel: string; modelId: string; label: string; type: string }[]) {
  return items.flatMap(item => {
    if (item.type !== "image" || item.providerId === "comfyui") return [];
    if (!/qwen/i.test(`${item.providerId} ${item.providerLabel} ${item.modelId} ${item.label}`)) return [];
    return [{ key: JSON.stringify([item.providerId, item.modelId]), label: item.label, providerLabel: item.providerLabel }];
  });
}

async function loadQwenModels() {
  qwenModels.value = qwenModelList(mediaProviders.flatMap(provider => provider.models.map(model => ({
    providerId: provider.id,
    providerLabel: provider.label,
    modelId: model.id,
    label: model.label,
    type: model.type,
  }))));
  const { data } = await axios.get<{ code: number; data: { providerId: string; providerLabel: string; modelId: string; label: string; type: string }[]; message?: string }>("/api/ai/media/models", { headers });
  if (data.code !== 200) throw new Error(data.message || "读取图像模型失败");
  const installed = qwenModelList(data.data);
  if (installed.length) qwenModels.value = installed;
}

async function probe(host: ComfyHost) {
  probing.value = host;
  probeResult.value = undefined;
  try {
    await saveSettings(() => ({ production: productionPatch() }));
    const { data } = await axios.get<{ code: number; data?: { baseUrl?: string }; message?: string }>("/api/production/comfyui/status", {
      params: { host },
      headers,
      timeout: 16 * 60_000,
    });
    probeResult.value = {
      host,
      ok: data.code === 200,
      message: data.code === 200 ? `ComfyUI 已连通 ${data.data?.baseUrl ?? ""}` : (data.message || "ComfyUI 未就绪"),
    };
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message || "ComfyUI 未就绪" : "ComfyUI 未就绪";
    probeResult.value = { host, ok: false, message };
  } finally {
    probing.value = undefined;
  }
}

async function loadInstances() {
  loadingInstances.value = true;
  try {
    await saveSettings(() => ({ production: productionPatch() }));
    const { data } = await axios.get<{ code: number; data: InstanceItem[]; message?: string }>("/api/production/autodl/instances", { headers });
    if (data.code !== 200) throw new Error(data.message || "读取实例失败");
    instances.value = data.data;
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || "读取实例失败" : "读取实例失败");
  } finally {
    loadingInstances.value = false;
  }
}

async function checkStatus() {
  checking.value = true;
  try {
    await saveSettings(() => ({ production: productionPatch() }));
    const { data } = await axios.get<{ code: number; data: { status: string }; message?: string }>("/api/production/autodl/status", { headers });
    if (data.code !== 200) throw new Error(data.message || "查询失败");
    statusMessage.value = data.data.status || "未知";
  } catch (error) {
    statusMessage.value = "";
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || "查询失败" : "查询失败");
  } finally {
    checking.value = false;
  }
}

async function power(action: "on" | "off") {
  powering.value = true;
  try {
    await saveSettings(() => ({ production: productionPatch() }));
    const { data } = await axios.post<{ code: number; message?: string }>("/api/production/autodl/power", { action }, { headers });
    if (data.code !== 200) throw new Error(data.message || "操作失败");
    ElMessage.success(action === "on" ? "已请求开机" : "已请求关机");
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || "操作失败" : "操作失败");
  } finally {
    powering.value = false;
  }
}

onMounted(() => {
  readForm();
  void loadWorkflows().catch(error => ElMessage.error(error instanceof Error ? error.message : "读取工作流失败"));
  void loadQwenModels().catch(error => ElMessage.error(error instanceof Error ? error.message : "读取图像模型失败"));
});

watch(() => {
  const current = settings.value.production;
  const source = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  return source.imageAdvanceMode === "auto" ? "auto" : "semi";
}, mode => { imageAdvanceMode.value = mode; });
</script>

<style lang="scss" scoped>
.workflow {
  --workflowAccent: var(--el-color-primary);
  --workflowLine: var(--el-border-color-lighter);
  --workflowSurface: var(--el-fill-color-lighter);
  display: grid;
  gap: 24px;
  min-width: 0;

  .pageHeader {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
    padding: 12px 0 16px;
    border-bottom: 1px solid var(--workflowLine);
    background: var(--el-bg-color-overlay);

    h3 {
      margin: 0;
      color: var(--el-text-color-primary);
      font-size: 25px;
      font-weight: 680;
      letter-spacing: 0.04em;
    }

    p {
      margin: 4px 0 0;
      color: var(--el-text-color-secondary);
      line-height: 1.55;
    }
  }

  .workflowNotices {
    display: grid;
    gap: 6px;
    padding: 10px 14px;
    border: 1px solid var(--el-color-warning-light-7);
    border-radius: var(--el-border-radius-base);
    background: var(--el-color-warning-light-9);
  }

  .settingGroup {
    display: grid;
    gap: 10px;
    min-width: 0;

    .groupHeader {
      display: flex;
      align-items: center;
      gap: 10px;

      .groupNumber {
        padding: 3px 6px;
        border: 1px solid var(--el-color-primary-light-7);
        border-radius: var(--el-border-radius-small);
        color: var(--workflowAccent);
        background: var(--el-color-primary-light-9);
        font-family: ui-monospace, monospace;
        font-size: 12px;
      }

      h3 {
        margin: 0;
        color: var(--el-text-color-primary);
        font-size: 15px;
        font-weight: 650;
      }

      &::after {
        content: "";
        flex: 1;
        height: 1px;
        margin-inline-start: 4px;
        background: var(--workflowLine);
      }
    }

    .generationGrid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
      align-items: start;
      gap: 12px;
    }

    .settingCard {
      display: grid;
      gap: 14px;
      min-width: 0;
      padding: clamp(12px, 2vw, 18px);
      border: 1px solid var(--workflowLine);
      border-radius: var(--el-border-radius-base);
      background: var(--workflowSurface);

      .cardHeader {
        h4 {
          margin: 0;
          color: var(--el-text-color-primary);
          font-size: 14px;
          font-weight: 650;
        }

        p {
          margin: 4px 0 0;
          color: var(--el-text-color-secondary);
          font-size: 13px;
          line-height: 1.55;
        }
      }

      .fieldGrid,
      .gemmaHost {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
        gap: 12px;
      }

      .field {
        display: grid;
        gap: 6px;
        min-width: 0;

        label {
          color: var(--el-text-color-regular);
          font-size: 13px;
          font-weight: 600;
        }

        .controlRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
        }

        :deep(.el-select) {
          min-width: 0;
          width: 100%;
        }
      }

      .hint {
        margin: 0;
        color: var(--el-text-color-secondary);
        font-size: 12px;
        line-height: 1.6;
      }

      .gemmaHost {
        align-items: center;
        padding: 12px;
        border-inline-start: 2px solid var(--workflowAccent);
        background: var(--el-color-primary-light-9);
      }

      .connectionBlock {
        display: grid;
        gap: 12px;
        padding-top: 14px;
        border-top: 1px solid var(--workflowLine);

        .connectionHeader,
        .connectionActions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 12px;

          :deep(.el-button + .el-button) {
            margin-inline-start: 0;
          }
        }

        .connectionHeader {
          justify-content: space-between;

          .switchField {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--el-text-color-regular);
            font-size: 13px;
          }
        }
      }

      .assetSizes {
        border-top: 1px solid var(--workflowLine);
        padding-top: 10px;
        color: var(--el-text-color-regular);
        font-size: 13px;

        summary {
          cursor: pointer;
          font-weight: 600;
        }

        dl {
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr);
          gap: 6px 10px;
          margin: 9px 0 0;
          line-height: 1.5;

          dd {
            margin: 0;
            color: var(--el-text-color-secondary);
          }
        }
      }
    }
  }
}
</style>

<style lang="scss">
.qcModelPopper.el-popper {
  z-index: 10000 !important;
  background: var(--el-bg-color-overlay);
}
</style>
