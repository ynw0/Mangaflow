<template>
  <div class="modelPopover">
    <el-popover
      v-model:visible="visible"
      trigger="click"
      placement="top-start"
      :width="390"
      :offset="10"
      :showArrow="false"
      popperClass="agentModelPopover"
      :popperStyle="{ padding: '18px', maxWidth: 'calc(100vw - 24px)' }">
      <template #reference>
        <el-button class="modelButton" text :disabled="disabled" aria-label="选择模型与思考等级">
          <modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.modelId" :size="14" />
          <span class="modelName">{{ selectedModelChoice?.label ?? "选择模型" }}</span>
          <component :is="visible ? IconChevronUp : IconChevronDown" :size="14" aria-hidden="true" />
        </el-button>
      </template>
      <div class="modelPanel">
        <div class="panelHeader">
          <span>对话模型</span>
          <span class="panelHint">当前会话</span>
        </div>
        <el-select v-model="selectedModel" filterable :disabled="disabled" placeholder="选择模型" aria-label="选择模型" noDataText="请先在设置中添加文本模型">
          <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
            <el-option v-for="model in provider.models" :key="model.id" :label="model.label" :value="JSON.stringify([provider.id, model.id])" />
          </el-option-group>
        </el-select>
        <div class="thinkingHeader">
          <span>思考等级</span>
          <span class="levelCurrent">{{ thinkingLabel }}</span>
        </div>
        <div class="thinkingOptions" role="group" aria-label="当前模型思考等级">
          <button
            v-for="option in thinkingOptions"
            :key="option.value"
            type="button"
            class="thinkingOption"
            :class="{ selected: thinkingLevel === option.value }"
            :disabled="disabled || !selectedModelChoice"
            :aria-pressed="thinkingLevel === option.value"
            :title="option.value"
            @click="setThinking(option.value)">
            {{ option.label }}
          </button>
        </div>
        <div class="probeControls">
          <el-button size="small" text :loading="probing" :disabled="disabled || !selectedModelChoice || probing" @click="probeThinking">探测实际支持档位</el-button>
          <span v-if="probeNotice" class="levelTip">{{ probeNotice }}</span>
        </div>
        <p v-if="!selectedModelChoice?.thinkingLevels?.length" class="levelTip">该模型没有声明可用思考档位；如需启用，请在文本模型设置中维护实际支持的等级。</p>
        <p v-else class="levelTip">仅显示已配置的支持档位。关闭表示不向接口发送思考等级；若模型有默认档位，仍以接口默认行为为准。</p>
      </div>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import axios from "axios";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import { modelIcon } from "@toonflow/model-icons";
import { customProviders, modelChoices, setModelThinkingLevel, settings, thinkingLevelForModel, thinkingLevelOptionsFor, probeAndSaveThinkingLevels } from "@/stores/settings";

const selectedModel = defineModel<string>({ default: "" });
const props = withDefaults(defineProps<{ active?: boolean; disabled?: boolean }>(), { active: true, disabled: false });
const visible = ref(false);
const probing = ref(false);
const probeNotice = ref("");
async function probeThinking() {
  const model = selectedModelChoice.value;
  if (!model || probing.value) return;
  probing.value = true;
  probeNotice.value = "";
  try {
    const result = await probeAndSaveThinkingLevels(model.providerId, model.modelId);
    probeNotice.value = `已探测：${result.levels.join("、") || "未确认可用档位"}。${result.notice ?? ""}`;
    ElMessage.success("模型支持的思考档位已更新");
  } catch (e) {
    const reason = axios.isAxiosError(e) ? e.response?.data?.message ?? e.message : e instanceof Error ? e.message : "探测失败";
    probeNotice.value = String(reason);
    ElMessage.error(String(reason));
  } finally {
    probing.value = false;
  }
}

const modelGroups = computed(() => customProviders.value.toSorted((left, right) => Number(right.id === "tfRouter") - Number(left.id === "tfRouter")));
const selectedModelChoice = computed(() => modelChoices.value.find(item => item.value === selectedModel.value));
const thinkingOptions = computed(() => thinkingLevelOptionsFor(selectedModelChoice.value?.thinkingLevels ?? []));
const thinkingLevel = computed(() => thinkingLevelForModel(selectedModelChoice.value));
const thinkingLabel = computed(() => thinkingOptions.value.find(item => item.value === thinkingLevel.value)?.label ?? "关闭");
function setThinking(level: string) {
  if (!props.disabled && selectedModel.value) setModelThinkingLevel(selectedModel.value, level);
}
watch(selectedModel, () => { probeNotice.value = ""; });
watch(modelChoices, items => {
  if (!selectedModel.value) selectedModel.value = items[0]?.value ?? "";
}, { immediate: true });
watch(selectedModel, value => {
  if (!value || settings.value.chatModelKey === value) return;
  settings.value = { ...settings.value, chatModelKey: value };
});
watch(() => !props.active || props.disabled, close => { if (close) visible.value = false; });
</script>

<style lang="scss">
.modelPopover {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  .modelButton {
    max-width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    color: var(--el-text-color-regular);
    > span { display: flex; gap: 6px; min-width: 0; }
    svg { flex-shrink: 0; }
    .modelName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  }
}
.agentModelPopover {
  .modelPanel { display: flex; flex-direction: column; gap: 12px; }
  .panelHeader, .thinkingHeader { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--el-text-color-primary); font-size: 13px; font-weight: 600; }
  .panelHint, .levelTip { color: var(--el-text-color-secondary); font-size: 11px; font-weight: 400; }
  .thinkingHeader { margin-top: 4px; }
  .levelCurrent { padding: 2px 9px; border-radius: 999px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-size: 12px; }
  .thinkingOptions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .thinkingOption {
    min-width: 0; min-height: 34px; padding: 6px 5px; border: 1px solid var(--el-border-color);
    border-radius: 9px; background: var(--el-fill-color-blank); color: var(--el-text-color-regular);
    font: inherit; font-size: 12px; cursor: pointer; transition: background 120ms ease, border-color 120ms ease;
    &:hover:not(:disabled) { background: var(--el-fill-color-light); border-color: var(--el-color-primary-light-5); }
    &.selected { color: var(--el-color-primary); border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); font-weight: 600; }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    &:disabled { cursor: not-allowed; opacity: 0.5; }
  }
  .levelTip { margin: 0; line-height: 1.5; }
  .probeControls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
}
</style>
