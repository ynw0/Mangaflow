<template>
  <section class="mediaBudget" aria-labelledby="mediaBudgetTitle">
    <h3 id="mediaBudgetTitle">每日生成额度</h3>
    <p>各工作区独立计数，适用于画布、Agent 和 MCP。额度留空表示不限，填写 0 可禁止对应生成。按服务端本地日期重置。</p>
    <el-form class="budgetForm" labelPosition="top" @submit.prevent="saveBudget">
      <el-form-item label="生成次数">
        <el-input v-model="dailyRequests" inputmode="numeric" placeholder="不限" :disabled="saving" />
      </el-form-item>
      <el-form-item label="视频总时长（秒）">
        <el-input v-model="dailyVideoSeconds" inputmode="numeric" placeholder="不限" :disabled="saving" />
      </el-form-item>
      <el-button nativeType="submit" :loading="saving">保存额度</el-button>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { saveSettings, settings } from "@/stores/settings";

const dailyRequests = ref("");
const dailyVideoSeconds = ref("");
const saving = ref(false);

watch(() => settings.value.mediaBudget, value => {
  const budget = value as { dailyRequests?: number; dailyVideoSeconds?: number } | undefined;
  dailyRequests.value = budget?.dailyRequests?.toString() ?? "";
  dailyVideoSeconds.value = budget?.dailyVideoSeconds?.toString() ?? "";
}, { immediate: true });

function parseLimit(value: string, label: string) {
  const text = value.trim();
  if (!text) return;
  const limit = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(limit)) throw new Error(`${label}须填写非负整数或留空`);
  return limit;
}

async function saveBudget() {
  saving.value = true;
  try {
    const requests = parseLimit(dailyRequests.value, "生成次数");
    const videoSeconds = parseLimit(dailyVideoSeconds.value, "视频总时长");
    await saveSettings(() => ({ mediaBudget: {
      ...(requests === undefined ? {} : { dailyRequests: requests }),
      ...(videoSeconds === undefined ? {} : { dailyVideoSeconds: videoSeconds }),
    } }));
    ElMessage.success("生成额度已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存生成额度失败");
  } finally { saving.value = false; }
}
</script>

<style scoped lang="scss">
.mediaBudget {
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);

  h3 { margin: 0; font-size: 14px; color: var(--el-text-color-primary); }
  p { margin: 8px 0 14px; font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; }

  .budgetForm {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 12px;

    .el-form-item { min-width: 120px; flex: 1; margin: 0; }
  }
}
</style>
