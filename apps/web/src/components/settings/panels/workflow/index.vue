<template>
  <div class="workflow">
    <section class="settingSection" aria-labelledby="imageTitle">
      <div class="settingInfo">
        <h3 id="imageTitle">出图</h3>
        <p class="description">可选 Qwen 图像 API，或与出视频相同的 ComfyUI。ComfyUI 下，没有参考图用文生图工作流，有参考图用图像编辑工作流。</p>
      </div>
      <el-select v-model="imageAdvanceMode" aria-label="出图模式">
        <el-option label="半自动：有问题就询问" value="semi" />
        <el-option label="自动：出图自己做到完成" value="auto" />
      </el-select>
      <el-text type="info">自动只作用于出图：自己选择、检验、回炉，直到这张图完成，不会自动出视频。半自动是有问题就询问。对话框里的「目标」是另一档，输入要完成的事之后会一直做，直到完成或你停止。</el-text>
      <el-select v-model="imageSource" aria-label="出图后端">
        <el-option label="Qwen 图像 API" value="qwen" />
        <el-option label="ComfyUI 工作流" value="comfyui" />
      </el-select>
      <template v-if="imageSource === 'qwen'">
        <el-select v-model="imageModelKey" aria-label="Qwen 图像模型" placeholder="选择 Qwen 图像模型">
          <el-option v-for="item in qwenModels" :key="item.key" :label="`${item.label} · ${item.providerLabel}`" :value="item.key" />
        </el-select>
        <el-text v-if="!qwenModels.length" type="warning" role="status">媒体模型里还没有 Qwen 图像模型。启动后会写入默认地址和密钥。</el-text>
      </template>
      <template v-else>
        <el-select v-model="imageT2iWorkflow" aria-label="文生图工作流" placeholder="选择文生图工作流">
          <el-option v-for="item in enabledImageWorkflows" :key="item.id" :label="`${item.label} · ${item.id}`" :value="item.id" />
        </el-select>
        <el-select v-model="imageEditWorkflow" aria-label="图像编辑工作流" placeholder="选择图像编辑工作流">
          <el-option v-for="item in enabledImageWorkflows" :key="`edit-${item.id}`" :label="`${item.label} · ${item.id}`" :value="item.id" />
        </el-select>
        <el-text type="info">默认文生图是 Flux.3 Klein 底模，默认图像编辑是蒸馏编辑。右侧关闭后，画布不再列出该工作流。当前默认不能关闭。保存后生效。</el-text>
        <div class="workflowList">
          <div v-for="item in imageWorkflows" :key="item.id" class="workflowItem">
            <span class="workflowName">{{ item.label }} · {{ item.id }}</span>
            <el-switch :key="`${item.id}-${workflowSwitchKey}`" :modelValue="workflowOn(item.id)" :aria-label="`${item.label}开关`" @update:modelValue="setWorkflowOn(item.id, $event)" />
          </div>
        </div>
      </template>
      <ul class="sizes">
        <li>角色设定图 2048×768，面部特写加正侧背</li>
        <li>场景要换机位或会反复出现时，四方向拼版 1024×1024</li>
        <li>只做氛围或转场时，无人空镜 1344×768，再交给视频</li>
        <li>道具按物体高宽选 768×1024、1024×1024 或 1344×768</li>
      </ul>
    </section>

    <section class="settingSection" aria-labelledby="videoTitle">
      <div class="settingInfo">
        <h3 id="videoTitle">出视频</h3>
        <p class="description">一个视频节点只放一个连续镜头。可选 ComfyUI 工作流，或设置「视频模型」里的云 API（Wan3.0）。</p>
      </div>
      <el-select v-model="videoProviderId" aria-label="出视频后端">
        <el-option label="ComfyUI 工作流" value="comfyui" />
        <el-option label="云视频 · Wan3.0" value="videoModel" />
      </el-select>
      <template v-if="videoProviderId === 'comfyui'">
        <el-select v-model="videoWorkflow" aria-label="默认视频工作流" placeholder="选择视频工作流">
          <el-option v-for="item in enabledMainVideoWorkflows" :key="item.id" :label="`${item.label} · ${item.id}`" :value="item.id" />
        </el-select>
        <el-text type="info">右侧关闭后，画布不再列出该工作流。当前默认不能关闭。保存后生效。</el-text>
        <div class="workflowList">
          <div v-for="item in videoWorkflows" :key="item.id" class="workflowItem">
            <span class="workflowName">{{ item.label }} · {{ item.id }}</span>
            <el-switch :key="`${item.id}-${workflowSwitchKey}`" :modelValue="workflowOn(item.id)" :aria-label="`${item.label}开关`" @update:modelValue="setWorkflowOn(item.id, $event)" />
          </div>
        </div>
        <el-text v-if="repairWorkflow" type="info">首尾帧修复用 {{ repairWorkflow.label }}（{{ repairWorkflow.id }}），不作为成片默认。</el-text>
      </template>
      <el-text v-else type="info">云视频使用设置 → 模型 →「视频模型」中的 API 地址与 Key，默认模型 wan3.0-video。</el-text>
    </section>

    <section class="settingSection" aria-labelledby="qcTitle">
      <div class="settingInfo">
        <h3 id="qcTitle">质检</h3>
        <p class="description">质检工作流单独一类。自动：视频生成后直接质检。手动：等你要求再质检。不质检则交给人工看。要用 Gemma，在下面选择「Gemma 4 E2B 质检」或「Gemma 4 E4B 质检」。选中后整段视频送进本机 Comfy，档位含音频时这一条同时听对白。执行只认这两条内置工作流。</p>
      </div>
      <el-select v-model="qcLevel" aria-label="质检档位">
        <el-option label="只视频" value="video" />
        <el-option label="视频 + 音频" value="videoAudio" />
        <el-option label="不质检（人工）" value="none" />
      </el-select>
      <el-select v-model="qcTrigger" :disabled="qcLevel === 'none'" aria-label="是否自动质检">
        <el-option label="自动" value="auto" />
        <el-option label="手动" value="manual" />
      </el-select>
      <el-text type="info">右侧关闭后，画面和音轨质检不再列出该工作流。当前选中的不能关闭。保存后生效。</el-text>
      <div class="workflowList">
        <div v-for="item in qcWorkflows" :key="item.id" class="workflowItem">
          <span class="workflowName">{{ item.label }} · {{ item.id }}</span>
          <el-switch :key="`${item.id}-${workflowSwitchKey}`" :modelValue="workflowOn(item.id)" :aria-label="`${item.label}开关`" @update:modelValue="setWorkflowOn(item.id, $event)" />
        </div>
      </div>
      <template v-if="qcLevel !== 'none'">
        <el-select v-model="videoQcModelId" filterable teleported fitInputWidth popperClass="qcModelPopper" aria-label="视频质检模型" placeholder="选择质检工作流或语言模型" @change="onVideoQcModel">
          <el-option-group v-if="enabledQcWorkflows.length" label="质检工作流">
            <el-option v-for="item in enabledQcWorkflows" :key="`qc-${item.id}`" :label="`${item.label} · ${item.id}`" :value="item.id" />
          </el-option-group>
          <el-option-group label="语言模型">
            <el-option v-for="item in languageVideoQcChoices" :key="`v-${item.providerId}-${item.modelId}`" :label="item.label" :value="item.modelId" />
          </el-option-group>
        </el-select>
        <el-select v-if="qcLevel === 'videoAudio'" v-model="audioQcModelId" filterable teleported fitInputWidth popperClass="qcModelPopper" aria-label="音频质检模型" placeholder="选择质检工作流或可听音频的模型" @change="onAudioQcModel">
          <el-option-group v-if="enabledQcWorkflows.length" label="质检工作流">
            <el-option v-for="item in enabledQcWorkflows" :key="`aqc-${item.id}`" :label="`${item.label} · ${item.id}`" :value="item.id" />
          </el-option-group>
          <el-option-group label="语言模型">
            <el-option v-for="item in audioQcChoices" :key="`a-${item.providerId}-${item.modelId}`" :label="item.label" :value="item.modelId" />
          </el-option-group>
        </el-select>
        <el-text v-if="!languageModels.length && !enabledQcWorkflows.length" type="warning" role="status">还没有质检工作流，也没有语言模型。</el-text>
        <el-text v-else-if="videoQcModelId && !videoQcModels.some(item => item.modelId === videoQcModelId)" type="warning" role="status">当前画面质检不在已开启的质检工作流或语言模型里。</el-text>
        <el-text v-else-if="qcLevel === 'videoAudio' && audioQcModelId && !audioQcModels.some(item => item.modelId === audioQcModelId)" type="warning" role="status">当前音轨质检不在已开启的质检工作流或语言模型里。</el-text>
        <el-text v-else-if="qcLevel === 'videoAudio' && !gemmaVideoQc && !gemmaAudioQc && audioQcModelId && !audioCapableModels.some(item => item.modelId === audioQcModelId)" type="warning" role="status">当前音轨质检模型未勾选音频输入。</el-text>
        <el-text v-if="qcLevel === 'videoAudio' && (gemmaVideoQc || gemmaAudioQc)" type="info">这条 Gemma 会同时看画面和听对白，不再另调另一个模型。</el-text>
      </template>
    </section>

    <section v-if="usesComfy" class="settingSection" aria-labelledby="comfyTitle">
      <div class="settingInfo">
        <h3 id="comfyTitle">{{ videoHost === 'local' ? '本机 ComfyUI' : 'AutoDL 上的 ComfyUI' }}</h3>
        <p class="description">{{ videoHost === 'local' ? '填写本机已经启动的 ComfyUI 地址，探测不会开机。出图和出视频共用这个地址。' : '留空则开机后使用实例的服务域名。手动地址只覆盖这台远程实例。出图和出视频共用这个地址。' }}</p>
      </div>
      <el-select v-model="videoHost" aria-label="ComfyUI 位置">
        <el-option label="AutoDL 上的 ComfyUI" value="autodl" />
        <el-option label="本机 ComfyUI" value="local" />
      </el-select>
      <div v-if="videoHost === 'local'" class="row">
        <el-input v-model="localComfyuiBaseUrl" aria-label="本机 ComfyUI 地址" placeholder="http://127.0.0.1:8188" />
        <el-button :loading="probing" @click="probe">探测</el-button>
      </div>
      <template v-else>
        <div class="row">
          <el-input v-model="comfyuiServiceField" aria-label="实例服务字段" placeholder="service_6006_domain" />
          <el-select v-model="comfyuiScheme" aria-label="访问协议" style="width: 120px">
            <el-option label="https" value="https" />
            <el-option label="http" value="http" />
          </el-select>
        </div>
        <div class="row">
          <el-input v-model="comfyuiBaseUrl" aria-label="手动 ComfyUI 地址" placeholder="一般留空，使用 AutoDL 上的 ComfyUI" />
          <el-button :loading="probing" @click="probe">开机并探测</el-button>
        </div>
      </template>
      <el-text v-if="probeMessage" :type="probeOk ? 'success' : 'danger'" role="status">{{ probeMessage }}</el-text>
    </section>

    <section v-if="usesComfy" class="settingSection" aria-labelledby="catalogTitle">
      <div class="settingInfo">
        <h3 id="catalogTitle">额外工作流</h3>
        <p class="description">填写本机目录的绝对路径，保存后重新扫描。顺序是：内置 workflows，然后用户数据里的 workflows（上传落盘处），最后是这个目录。</p>
      </div>
      <ul class="sizes">
        <li>在该目录下建 image、video、qc。每个工作流是「名字.bindings.yaml」，yaml 的 workflow 字段指向同一目录里的 API JSON。id 是「子目录/文件名」，例如 video/my_h3。</li>
        <li>同名指 id 完全相同。先扫到的保留，后面的同名文件不替换，所以这里不能改内置的二采或 Gemma。</li>
        <li>出图、出视频会按 bindings 跑这里的新 id。下面的上传只接收视频 JSON，写到用户数据目录，不写这个目录，也不能用来加质检。</li>
        <li>Gemma 质检直接选本页「质检」里的 Gemma 4 E2B（qc/gemma4E2b）或 E4B（qc/gemma4E4b），并在 ComfyUI 的 models/text_encoders 放入对应权重。若要再放一份，例如 E:\Manga\pipeline\workflows\qc\myGemma.bindings.yaml（workflow: ./myGemmaApi.json），保存后列表会出现 qc/myGemma，但当前质检不会改跑这份 JSON。</li>
      </ul>
      <el-input v-model="workflowRoot" aria-label="额外工作流目录" placeholder="可选，例如 E:\Manga\pipeline\workflows" />
    </section>
    <section v-if="usesComfy" class="settingSection" aria-labelledby="uploadTitle">
      <div class="settingInfo">
        <h3 id="uploadTitle">上传 API 工作流</h3>
        <p class="description">只上传出视频用的 ComfyUI API JSON，不能用来加质检。服务端用设置里的语言模型对照内置 bindings 模板生成新绑定；校验失败不写盘。落在用户数据 workflows，不写额外目录，不覆盖同名 id（含内置）。</p>
      </div>
      <el-input v-model="uploadId" aria-label="工作流 id" placeholder="例如 my_h3 或 video/my_h3" />
      <el-input v-model="uploadLabel" aria-label="显示名称" placeholder="可选显示名" />
      <div class="row">
        <input ref="uploadInput" class="uploadInput" type="file" accept="application/json,.json" aria-label="选择 API 工作流 JSON" @change="onUploadFile" />
        <el-button type="primary" :loading="uploading" :disabled="!uploadId.trim()" @click="pickUpload">选择并上传</el-button>
      </div>
      <el-text v-if="uploadMessage" :type="uploadOk ? 'success' : 'danger'" role="status">{{ uploadMessage }}</el-text>
    </section>

    <section v-if="usesComfy && videoHost === 'autodl'" class="settingSection" aria-labelledby="autodlTitle">
      <div class="settingHeader">
        <div class="settingInfo">
          <h3 id="autodlTitle">AutoDL</h3>
          <p class="description">只在出视频走 AutoDL 时使用。生成前先把这台实例开到 running，再连上面的 ComfyUI。</p>
        </div>
        <el-switch v-model="autodlEnsureRunning" aria-label="生成前先开机" />
      </div>
      <el-input v-model="autodlBaseUrl" aria-label="AutoDL 地址" />
      <el-input v-model="autodlToken" type="password" showPassword aria-label="AutoDL Token" placeholder="开发者 Token" />
      <div class="row">
        <el-select v-model="autodlInstanceUuid" filterable allowCreate defaultFirstOption aria-label="AutoDL 实例" placeholder="实例 UUID">
          <el-option v-for="item in instances" :key="item.uuid" :label="`${item.name || item.uuid} · ${item.status}`" :value="item.uuid" />
        </el-select>
        <el-button :loading="loadingInstances" @click="loadInstances">读取实例</el-button>
      </div>
      <el-input v-model="autodlStartCommand" aria-label="开机命令" placeholder="可选开机命令" />
      <div class="row">
        <el-button :loading="powering" @click="power('on')">开机</el-button>
        <el-button :loading="powering" @click="power('off')">关机</el-button>
        <el-button :loading="checking" @click="checkStatus">查状态</el-button>
        <el-text v-if="statusMessage" role="status">{{ statusMessage }}</el-text>
      </div>
    </section>

    <el-button type="primary" :loading="saving" @click="save">保存</el-button>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { mediaProviders } from "@toonflow/providers";
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { modelChoices, saveSettings, settings } from "@/stores/settings";

type WorkflowItem = { id: string; label: string };
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
const videoHost = ref("autodl");
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
const imageWorkflows = ref<WorkflowItem[]>([]);
const videoWorkflows = ref<WorkflowItem[]>([]);
const qcWorkflows = ref<WorkflowItem[]>([]);
const instances = ref<InstanceItem[]>([]);
const probing = ref(false);
const probeOk = ref(false);
const probeMessage = ref("");
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
const enabledMainVideoWorkflows = computed(() => mainVideoWorkflows.value.filter(item => workflowOn(item.id)));
const enabledQcWorkflows = computed(() => qcWorkflows.value.filter(item => workflowOn(item.id)));
const repairWorkflow = computed(() => videoWorkflows.value.find(item => item.id === "video/h3_flf_repair"));
const languageModels = computed(() => modelChoices.value);
const gemmaVideoQc = computed(() => isGemmaQc(videoQcModelId.value));
const gemmaAudioQc = computed(() => isGemmaQc(audioQcModelId.value));
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
    videoHost: videoHost.value === "local" ? "local" : "autodl",
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
  const { data } = await axios.get<{ code: number; data: { image: WorkflowItem[]; video: WorkflowItem[]; qc: WorkflowItem[] }; message?: string }>("/api/production/workflows", { headers });
  if (data.code !== 200) throw new Error(data.message || "读取工作流失败");
  imageWorkflows.value = data.data.image;
  videoWorkflows.value = data.data.video;
  qcWorkflows.value = data.data.qc;
  const enabledImage = data.data.image.filter(item => workflowOn(item.id));
  if (enabledImage.length && !enabledImage.some(item => item.id === imageT2iWorkflow.value)) imageT2iWorkflow.value = enabledImage.find(item => item.id === "image/flux3KleinT2i")?.id || enabledImage[0]?.id || imageT2iWorkflow.value;
  if (enabledImage.length && !enabledImage.some(item => item.id === imageEditWorkflow.value)) imageEditWorkflow.value = enabledImage.find(item => item.id === "image/flux3KleinDistilledEdit")?.id || enabledImage[0]?.id || imageEditWorkflow.value;
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

async function probe() {
  probing.value = true;
  probeMessage.value = "";
  try {
    await saveSettings(() => ({ production: productionPatch() }));
    const local = videoHost.value === "local";
    const override = local ? localComfyuiBaseUrl.value.trim() : comfyuiBaseUrl.value.trim();
    const { data } = await axios.get<{ code: number; data?: { baseUrl?: string }; message?: string }>("/api/production/comfyui/status", {
      ...(override ? { params: { baseUrl: override } } : {}),
      headers,
      timeout: 16 * 60_000,
    });
    probeOk.value = data.code === 200;
    probeMessage.value = data.code === 200 ? `${local ? "本机" : "远程"} ComfyUI 已连通 ${data.data?.baseUrl ?? override}` : (data.message || "ComfyUI 未就绪");
  } catch (error) {
    probeOk.value = false;
    probeMessage.value = axios.isAxiosError(error) ? error.response?.data?.message || "ComfyUI 未就绪" : "ComfyUI 未就绪";
  } finally {
    probing.value = false;
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
  display: flex;
  flex-direction: column;
  gap: 24px;

  .settingSection {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .settingHeader {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .settingInfo {
    h3, h4 {
      margin: 0;
    }

    .description {
      margin: 6px 0 0;
      color: var(--el-text-color-secondary);
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;

    .el-input, .el-select {
      flex: 1;
    }
  }

  .uploadInput {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
  }

  ul {
    margin: 0;
    padding-left: 18px;
  }

  .workflowList {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .workflowItem {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
  }

  .workflowName {
    min-width: 0;
    line-height: 1.4;
    color: var(--el-text-color-regular);
  }

  .sizes {
    color: var(--el-text-color-regular);
  }

  span {
    color: var(--el-text-color-secondary);
  }
}
</style>

<style lang="scss">
.qcModelPopper.el-popper {
  z-index: 10000 !important;
  background: var(--el-bg-color-overlay);
}
</style>
