<template>
  <div class="videoModel">
    <section class="settingSection" aria-labelledby="videoModelTitle">
      <div class="settingInfo">
        <h3 id="videoModelTitle">云视频 API</h3>
        <p class="description">独立于媒体模型。工作流里选「云视频 · Wan3.0」时使用这里的地址和密钥。默认走 APIMart 国内节点。</p>
      </div>
      <el-input v-model="baseUrl" aria-label="API 地址" placeholder="https://api.apimart.ai/v1" />
      <el-input v-model="apiKey" type="password" showPassword aria-label="API Key" placeholder="API Key" autocomplete="off" />
      <el-select v-model="modelId" aria-label="默认云视频模型">
        <el-option label="Wan3.0 · wan3.0-video" value="wan3.0-video" />
      </el-select>
    </section>
    <el-button type="primary" :loading="saving" @click="save">保存</el-button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { saveSettings, settings } from "@/stores/settings";

const defaultBaseUrl = "https://api.apimart.ai/v1";
const defaultModelId = "wan3.0-video";

const baseUrl = ref(defaultBaseUrl);
const apiKey = ref("");
const modelId = ref(defaultModelId);
const saving = ref(false);

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

function readForm() {
  const current = settings.value.videoModel;
  const source = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  baseUrl.value = text(source.baseUrl, "") || defaultBaseUrl;
  apiKey.value = text(source.apiKey, "");
  modelId.value = text(source.modelId, "") || defaultModelId;
}

function videoModelPatch() {
  return {
    baseUrl: baseUrl.value.trim() || defaultBaseUrl,
    apiKey: apiKey.value.trim(),
    modelId: modelId.value.trim() || defaultModelId,
  };
}

async function save() {
  saving.value = true;
  try {
    await saveSettings(() => ({ videoModel: videoModelPatch() }));
    window.dispatchEvent(new Event("toonflow:provider-config-changed"));
    ElMessage.success("视频模型配置已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

onMounted(readForm);
</script>

<style lang="scss" scoped>
.videoModel {
  display: flex;
  flex-direction: column;
  gap: 24px;

  .settingSection {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .settingInfo {
    h3 {
      margin: 0;
    }

    .description {
      margin: 6px 0 0;
      color: var(--el-text-color-secondary);
    }
  }
}
</style>
