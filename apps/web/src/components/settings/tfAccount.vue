<template>
  <div v-if="!apiKey" class="tfAccount">
    <el-text size="small" type="info">填写API Key开始使用官方供应商</el-text>
    <div class="setupForm">
      <el-input
        v-model="draftKey"
        class="setupInput"
        type="password"
        dir="ltr"
        showPassword
        placeholder="粘贴 API Key"
        :disabled="saving"
        @keyup.enter="submitKey" />
      <el-button type="primary" size="small" :loading="saving" :disabled="!draftKey.trim()" @click="submitKey">保存</el-button>
    </div>
    <el-text v-if="setupError" size="small" type="danger">{{ setupError }}</el-text>
    <el-button tag="a" href="https://api.toonflow.net/" target="_blank" rel="noopener noreferrer" text type="primary" :icon="IconExternalLink">
      前往 TF-Router 官网 获取 API Key
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconExternalLink } from "@tabler/icons-vue";

const props = defineProps<{
  apiKey: string;
  saveApiKey: (key: string) => Promise<void>;
}>();
const apiKey = computed(() => props.apiKey.trim().replace(/^Bearer\s+/i, "").trim());
const draftKey = ref("");
const saving = ref(false);
const setupError = ref("");

async function submitKey() {
  const key = draftKey.value.trim();
  if (!key || saving.value) return;
  saving.value = true;
  setupError.value = "";
  try {
    await props.saveApiKey(key);
    draftKey.value = "";
  } catch (error) {
    setupError.value = error instanceof Error ? error.message : "保存失败，请重试";
  } finally {
    saving.value = false;
  }
}

watch(apiKey, () => {
  draftKey.value = "";
  setupError.value = "";
});
</script>

<style lang="scss" scoped>
.tfAccount {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  padding: 14px;
  background: var(--el-fill-color-light);
  border-radius: var(--el-border-radius-base);

  .setupForm {
    display: flex;
    gap: 8px;

    .setupInput {
      flex: 1;
      min-width: 0;
    }
  }
}
</style>
