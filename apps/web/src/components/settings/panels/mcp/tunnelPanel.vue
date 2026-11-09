<template>
  <section class="tunnelPanel" aria-labelledby="tunnelTitle">
    <div class="panelHeader">
      <h3 id="tunnelTitle">TryCloudflare 公网隧道</h3>
      <el-button text :loading="loading" @click="refresh">刷新</el-button>
    </div>
    <el-alert v-if="error || status?.error" :title="error || status?.error || ''" type="error" :closable="false" showIcon />
    <template v-if="status">
      <el-tag effect="plain" :type="status.phase === 'running' ? 'success' : 'info'">{{ phaseLabel }}</el-tag>
      <div v-if="status.supported" class="actions">
        <el-button v-if="!status.installed" :disabled="status.busy || working" @click="act('install')">下载 cloudflared</el-button>
        <el-button v-if="status.installed" type="primary" :disabled="status.busy || working" @click="act('start')">开启公网隧道</el-button>
        <el-button v-if="status.busy" :disabled="working" @click="act('stop')">{{ status.phase === 'running' ? '关闭隧道' : '取消' }}</el-button>
      </div>
      <p v-else class="hint">内置隧道管理当前支持 Windows x64 本机连接。</p>
      <p class="hint">无需账号或域名。临时 HTTPS 地址会在重新开启后变化，请重新复制 MCP 配置。</p>
      <p v-if="status.received !== undefined" class="hint">已下载 {{ (status.received / 1024 / 1024).toFixed(1) }} MB<template v-if="status.total"> / {{ (status.total / 1024 / 1024).toFixed(1) }} MB</template></p>
      <el-input v-if="status.publicUrl" :modelValue="status.publicUrl" readonly dir="ltr" aria-label="隧道公网地址" />
      <div class="accessOptions">
        <el-checkbox v-model="access.mcp" :disabled="working">MCP</el-checkbox>
        <el-checkbox v-model="access.management" :disabled="working">管理页面</el-checkbox>
        <el-checkbox v-model="access.files" :disabled="working">工作区文件接口</el-checkbox>
        <el-checkbox v-model="access.api" :disabled="working">其他 API</el-checkbox>
      </div>
      <div v-if="status.supported" class="actions">
        <el-button :loading="working" @click="saveAccess">保存开放范围</el-button>
        <el-button :disabled="working" @click="copyCredential">复制管理／OAuth 授权凭证</el-button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";

type PublicAccess = { mcp: boolean; management: boolean; files: boolean; api: boolean };
type TunnelStatus = { phase: "idle" | "downloading" | "starting" | "running" | "error";
  supported: boolean; installed: boolean; busy: boolean; publicAccess: PublicAccess;
  publicUrl?: string; error?: string; received?: number; total?: number };
const emit = defineEmits<{ changed: [running: boolean] }>();
const headers = { "x-toonflow-workspace": "1" };
const status = ref<TunnelStatus>();
const error = ref("");
const loading = ref(false);
const working = ref(false);
const access = reactive<PublicAccess>({ mcp: true, management: false, files: false, api: false });
const phaseLabel = computed(() => {
  if (!status.value) return "";
  if (!status.value.installed && status.value.phase === "idle") return "客户端未下载";
  return { idle: "未开启隧道", downloading: "下载中", starting: "正在连接 TryCloudflare", running: "已连接", error: "操作失败" }[status.value.phase];
});
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let initialized = false;
const controller = new AbortController();
function message(cause: unknown) { return axios.isAxiosError(cause) ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : "操作失败"; }

async function refresh() {
  if (loading.value || disposed) return;
  clearTimeout(timer);
  loading.value = true;
  try {
    const { data } = await axios.get<{ data: TunnelStatus }>("/api/mcp/tunnel/status", { headers, signal: controller.signal });
    const wasRunning = status.value?.phase === "running";
    status.value = data.data;
    if (!initialized) { Object.assign(access, data.data.publicAccess); initialized = true; }
    error.value = "";
    if (wasRunning !== (data.data.phase === "running")) emit("changed", data.data.phase === "running");
  } catch (cause) { if (!disposed) error.value = message(cause); }
  finally {
    loading.value = false;
    if (!disposed && status.value?.supported) timer = setTimeout(() => { void refresh(); }, 2000);
  }
}

async function act(action: "install" | "start" | "stop") {
  working.value = true;
  try {
    await axios.post(`/api/mcp/tunnel/${action}`, {}, { headers, signal: controller.signal });
    await refresh();
  } catch (cause) { error.value = message(cause); }
  finally { working.value = false; }
}
async function saveAccess() {
  working.value = true;
  try { await axios.put("/api/mcp/tunnel/access", { ...access }, { headers, signal: controller.signal }); ElMessage.success("开放范围已保存"); }
  catch (cause) { error.value = message(cause); }
  finally { working.value = false; }
}
async function copyCredential() {
  working.value = true;
  try {
    const { data } = await axios.get<{ data: { token: string } }>("/api/mcp/tunnel/credential", { headers, signal: controller.signal });
    if (!data.data.token) throw new Error("请先开启 MCP 或公网隧道以创建凭证");
    await import("@/lib/clipboard").then(module => module.writeClipboardText(data.data.token));
    ElMessage.success("凭证已复制");
  } catch (cause) { error.value = message(cause); }
  finally { working.value = false; }
}
onMounted(() => { void refresh(); });
onUnmounted(() => { disposed = true; clearTimeout(timer); controller.abort(); });
</script>

<style scoped lang="scss">
.tunnelPanel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  .panelHeader { display: flex; align-items: center; justify-content: space-between; h3 { margin: 0; font-size: 14px; } }
  .actions, .accessOptions { display: flex; flex-wrap: wrap; gap: 8px; }
  .actions { .el-button { margin-left: 0; } }
  .hint { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; }
  .el-tag { align-self: flex-start; }
}
</style>
