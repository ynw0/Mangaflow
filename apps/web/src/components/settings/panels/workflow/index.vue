<template>
  <div class="workflow">
    <section class="settingSection" aria-labelledby="imageTitle">
      <div class="settingInfo">
        <h3 id="imageTitle">出图</h3>
        <p class="description">直接调用 Qwen 图像 API，不走 ComfyUI 出图工作流。默认模型是 Qwen Image 3.0 Pro。</p>
      </div>
      <el-select v-model="imageModelKey" aria-label="Qwen 图像模型" placeholder="选择 Qwen 图像模型">
        <el-option v-for="item in qwenModels" :key="item.key" :label="`${item.label} · ${item.providerLabel}`" :value="item.key" />
      </el-select>
      <el-text v-if="!qwenModels.length" type="warning" role="status">媒体模型里还没有 Qwen 图像模型。启动后会写入默认地址和密钥。</el-text>
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
        <el-select v-model="videoHost" aria-label="视频 ComfyUI 位置">
          <el-option label="AutoDL 上的 ComfyUI" value="autodl" />
          <el-option label="本机 ComfyUI" value="local" />
        </el-select>
        <el-select v-model="videoWorkflow" aria-label="默认视频工作流" placeholder="选择视频工作流">
          <el-option v-for="item in mainVideoWorkflows" :key="item.id" :label="`${item.label} · ${item.id}`" :value="item.id" />
        </el-select>
        <el-text v-if="repairWorkflow" type="info">首尾帧修复固定用 {{ repairWorkflow.label }}（{{ repairWorkflow.id }}），不作为成片默认。</el-text>
      </template>
      <el-text v-else type="info">云视频使用设置 → 模型 →「视频模型」中的 API 地址与 Key，默认模型 wan3.0-video。</el-text>
    </section>

    <section v-if="videoProviderId === 'comfyui'" class="settingSection" aria-labelledby="comfyTitle">
      <div class="settingInfo">
        <h3 id="comfyTitle">{{ videoHost === 'local' ? '本机 ComfyUI' : 'AutoDL 上的 ComfyUI' }}</h3>
        <p class="description">{{ videoHost === 'local' ? '填写本机已经启动的 ComfyUI 地址，探测不会开机。' : '留空则开机后使用实例的服务域名。手动地址只覆盖这台远程实例。' }}</p>
      </div>
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

    <section v-if="videoProviderId === 'comfyui'" class="settingSection" aria-labelledby="catalogTitle">
      <div class="settingInfo">
        <h3 id="catalogTitle">额外工作流</h3>
        <p class="description">内置视频工作流保留。额外目录只追加新的 video 工作流，同名不覆盖。</p>
      </div>
      <el-input v-model="workflowRoot" aria-label="额外工作流目录" placeholder="可选，例如 E:\Manga\pipeline\workflows" />
    </section>
    <section v-if="videoProviderId === 'comfyui'" class="settingSection" aria-labelledby="uploadTitle">
      <div class="settingInfo">
        <h3 id="uploadTitle">上传 API 工作流</h3>
        <p class="description">上传 ComfyUI 导出的 API JSON。服务端用设置里的语言模型对照内置 bindings 模板生成新绑定；校验失败不写盘。落在用户数据 workflows，不覆盖同名（含内置）。</p>
      </div>
      <el-input v-model="uploadId" aria-label="工作流 id" placeholder="例如 my_h3 或 video/my_h3" />
      <el-input v-model="uploadLabel" aria-label="显示名称" placeholder="可选显示名" />
      <div class="row">
        <input ref="uploadInput" class="uploadInput" type="file" accept="application/json,.json" aria-label="选择 API 工作流 JSON" @change="onUploadFile" />
        <el-button type="primary" :loading="uploading" :disabled="!uploadId.trim()" @click="pickUpload">选择并上传</el-button>
      </div>
      <el-text v-if="uploadMessage" :type="uploadOk ? 'success' : 'danger'" role="status">{{ uploadMessage }}</el-text>
    </section>

    <section v-if="videoProviderId === 'comfyui' && videoHost === 'autodl'" class="settingSection" aria-labelledby="autodlTitle">
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
import { computed, onMounted, ref } from "vue";
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
const imageProviderId = ref("qwenImage");
const imageModelId = ref("qwen-image-3.0-pro");
const videoProviderId = ref<"comfyui" | "videoModel">("comfyui");
const videoHost = ref("autodl");
const localComfyuiBaseUrl = ref("http://127.0.0.1:8188");
const videoWorkflow = ref("video/h3_ref2va_1080p");
const qwenModels = ref<QwenModel[]>([]);
const autodlBaseUrl = ref("https://www.autodl.art");
const autodlToken = ref("");
const autodlInstanceUuid = ref("");
const autodlStartCommand = ref("");
const autodlEnsureRunning = ref(false);
const videoWorkflows = ref<WorkflowItem[]>([]);
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
const mainVideoWorkflows = computed(() => videoWorkflows.value.filter(item => item.id !== "video/h3_flf_repair"));
const repairWorkflow = computed(() => videoWorkflows.value.find(item => item.id === "video/h3_flf_repair"));

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function readForm() {
  const current = settings.value.production;
  const source = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  const savedUrl = text(source.comfyuiBaseUrl, "");
  comfyuiBaseUrl.value = savedUrl === "http://127.0.0.1:8188" || savedUrl === "http://localhost:8188" ? "" : savedUrl;
  comfyuiServiceField.value = text(source.comfyuiServiceField, "service_6006_domain");
  comfyuiScheme.value = text(source.comfyuiScheme, "https") === "http" ? "http" : "https";
  workflowRoot.value = text(source.workflowRoot, "");
  imageProviderId.value = text(source.imageProviderId, "") || "qwenImage";
  imageModelId.value = text(source.imageModelId, "") || "qwen-image-3.0-pro";
  videoProviderId.value = source.videoProviderId === "videoModel" ? "videoModel" : "comfyui";
  videoHost.value = source.videoHost === "local" ? "local" : "autodl";
  localComfyuiBaseUrl.value = text(source.localComfyuiBaseUrl, "") || "http://127.0.0.1:8188";
  videoWorkflow.value = text(source.videoWorkflow, "") || "video/h3_ref2va_1080p";
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
    imageSource: "qwen",
    imageProviderId: imageProviderId.value.trim() || "qwenImage",
    imageModelId: imageModelId.value.trim() || "qwen-image-3.0-pro",
    videoProviderId: videoProviderId.value === "videoModel" ? "videoModel" : "comfyui",
    videoHost: videoHost.value === "local" ? "local" : "autodl",
    localComfyuiBaseUrl: localComfyuiBaseUrl.value.trim() || "http://127.0.0.1:8188",
    videoWorkflow: videoWorkflow.value.trim() || "video/h3_ref2va_1080p",
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
  const { data } = await axios.get<{ code: number; data: { image: WorkflowItem[]; video: WorkflowItem[] }; message?: string }>("/api/production/workflows", { headers });
  if (data.code !== 200) throw new Error(data.message || "读取工作流失败");
  videoWorkflows.value = data.data.video;
  const selectable = data.data.video.filter(item => item.id !== "video/h3_flf_repair");
  if (selectable.length && !selectable.some(item => item.id === videoWorkflow.value)) videoWorkflow.value = selectable[0]?.id || videoWorkflow.value;
}

async function loadQwenModels() {
  const { data } = await axios.get<{ code: number; data: { providerId: string; providerLabel: string; modelId: string; label: string; type: string }[]; message?: string }>("/api/ai/media/models", { headers });
  if (data.code !== 200) throw new Error(data.message || "读取图像模型失败");
  qwenModels.value = data.data.flatMap(item => {
    if (item.type !== "image" || item.providerId === "comfyui") return [];
    if (!/qwen/i.test(`${item.providerId} ${item.providerLabel} ${item.modelId} ${item.label}`)) return [];
    return [{ key: JSON.stringify([item.providerId, item.modelId]), label: item.label, providerLabel: item.providerLabel }];
  });
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

  .sizes {
    color: var(--el-text-color-regular);
  }

  span {
    color: var(--el-text-color-secondary);
  }
}
</style>
