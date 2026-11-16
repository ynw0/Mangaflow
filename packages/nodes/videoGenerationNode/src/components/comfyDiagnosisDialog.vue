<template>
  <el-dialog v-model="visible" title="ComfyUI 故障分析" width="min(740px, 94vw)" appendToBody @close="cancel">
    <form class="diagnosisForm" @submit.prevent="analyze">
      <div class="diagnosisOptions">
        <label>未单独配置时使用的模型
          <el-select v-model="modelKey" filterable placeholder="选择模型" :loading="loadingModels" :disabled="running">
            <el-option v-for="model in models" :key="keyOf(model)" :value="keyOf(model)" :label="`${model.providerLabel} / ${model.label}`" />
          </el-select>
        </label>
        <el-checkbox v-model="terminal" :disabled="running">读取原实例的终端缓冲</el-checkbox>
      </div>
      <el-input v-model="suppliedLog" type="textarea" :rows="3" maxlength="128000" :disabled="running" placeholder="可粘贴补充日志" aria-label="补充日志" />
      <div class="diagnosisActions">
        <el-button v-if="running" @click="cancel">停止分析</el-button>
        <el-button v-else type="primary" nativeType="submit" :disabled="!modelKey || !generationId">开始分析</el-button>
        <span v-if="running" role="status">正在读取证据并分析</span>
      </div>
      <p v-if="error" class="diagnosisError" role="alert">{{ error }}</p>
    </form>
    <article v-if="result" class="diagnosisResult">
      <header>
        <strong>{{ stages[result.report.stage] ?? result.report.stage }} · {{ result.report.confidence }}% 置信度</strong>
        <span>{{ result.modelId }}</span>
      </header>
      <p v-if="result.report.node">节点 {{ result.report.node }}</p>
      <p>{{ result.report.conclusion }}</p>
      <p><strong>根因</strong> {{ result.report.rootCause }}</p>
      <details>
        <summary>证据（{{ result.report.evidence.length }} 条）</summary>
        <ul>
          <li v-for="(item, index) in result.report.evidence" :key="index"><strong>{{ item.source }}</strong> {{ item.excerpt }}</li>
        </ul>
      </details>
      <template v-if="result.report.steps.length">
        <strong>修复步骤</strong>
        <ol><li v-for="(step, index) in result.report.steps" :key="index">{{ step }}</li></ol>
      </template>
      <template v-if="result.report.verification.length">
        <strong>验证</strong>
        <pre v-for="(step, index) in result.report.verification" :key="index">{{ step }}</pre>
      </template>
      <details v-if="result.report.missing.length || result.unavailable.length">
        <summary>缺少的证据</summary>
        <ul><li v-for="(item, index) in [...result.report.missing, ...result.unavailable]" :key="index">{{ item }}</li></ul>
      </details>
    </article>
  </el-dialog>
</template>

<script setup lang="ts">
import { onScopeDispose, ref } from "vue";
import { ElButton, ElCheckbox, ElDialog, ElInput, ElOption, ElSelect } from "element-plus";
import { useNodeAi, type NodeAiModel } from "@toonflow/nodes-scaffold/nodeAi";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";

const stages: Record<string, string> = {
  preparation: "准备", submission: "提交", queued: "排队", execution: "执行", query: "查询", unknown: "阶段待确认",
};
type Result = { modelId: string; unavailable: string[]; report: {
  stage: string; node: string; conclusion: string; rootCause: string; confidence: number;
  evidence: { source: string; excerpt: string }[]; steps: string[]; verification: string[]; missing: string[];
} };
const ai = useNodeAi();
const files = useNodeFiles();
const visible = ref(false);
const generationId = ref("");
const terminal = ref(false);
const suppliedLog = ref("");
const models = ref<NodeAiModel[]>([]);
const modelKey = ref("");
const loadingModels = ref(false);
const running = ref(false);
const error = ref("");
const result = ref<Result>();
let controller: AbortController | undefined;

const keyOf = (model: NodeAiModel) => JSON.stringify([model.providerId, model.modelId]);

async function open(id: string) {
  if (running.value) return;
  if (generationId.value !== id) {
    generationId.value = id;
    result.value = undefined;
    suppliedLog.value = "";
    terminal.value = false;
  }
  visible.value = true;
  if (models.value.length || loadingModels.value) return;
  error.value = "";
  loadingModels.value = true;
  try {
    models.value = await ai.getModels();
    modelKey.value = models.value[0] ? keyOf(models.value[0]) : "";
    if (!models.value.length) error.value = "请先在设置中配置可用的文本模型";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "读取模型失败";
  } finally {
    loadingModels.value = false;
  }
}

async function analyze() {
  const model = models.value.find(item => keyOf(item) === modelKey.value);
  if (running.value || !model || !generationId.value) return;
  const active = controller = new AbortController();
  const request = { generationId: generationId.value, providerId: model.providerId, modelId: model.modelId,
    terminal: terminal.value, suppliedLog: suppliedLog.value };
  running.value = true;
  error.value = "";
  result.value = undefined;
  try {
    const workspace = files.getWorkspaceFiles();
    const { directory } = await workspace.list();
    active.signal.throwIfAborted();
    const response = await fetch("/api/production/comfyDiagnosis", {
      method: "POST", headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({ ...request, directory }), signal: active.signal,
    });
    const body = await response.json() as { code: number; message?: string; data: Result };
    if (!response.ok || body.code !== 200) throw new Error(body.message || "ComfyUI 故障分析失败");
    active.signal.throwIfAborted();
    result.value = body.data;
  } catch (cause) {
    if (!active.signal.aborted) error.value = cause instanceof Error ? cause.message : "ComfyUI 故障分析失败";
  } finally {
    if (controller === active) {
      running.value = false;
      controller = undefined;
    }
  }
}

function cancel() { controller?.abort(); }
onScopeDispose(cancel);
defineExpose({ open });
</script>

<style scoped lang="scss">
.diagnosisForm {
  display: grid;
  gap: 10px;
  .diagnosisOptions, .diagnosisActions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  }
  .diagnosisOptions label:first-child {
    display: grid;
    gap: 4px;
    flex: 1;
    min-width: 180px;
  }
  .diagnosisError { margin: 0; color: var(--el-color-danger); }
}
.diagnosisResult {
  margin-top: 16px;
  padding: 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow-wrap: anywhere;
  header {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    span { color: var(--el-text-color-secondary); }
  }
  pre { white-space: pre-wrap; padding: 8px; background: var(--el-fill-color-light); }
  details { margin: 8px 0; }
}
</style>
