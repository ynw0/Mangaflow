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
        <thinking-effort-slider :model-value="thinkingLevel" :options="thinkingOptions"
          :disabled="disabled || !selectedModelChoice" aria-label="当前模型思考等级"
          @update:model-value="setThinking" />
        <p v-if="!selectedModelChoice?.thinkingLevels?.length" class="levelTip">该模型尚未配置思考档位，请到「设置 → 文本模型 → 编辑 → 模型思考等级」探测。</p>
        <p v-else class="levelTip">仅显示已配置的支持档位。“服务默认”不发送等级参数；若模型有默认档位，仍以接口默认行为为准。</p>
      </div>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import { modelIcon } from "@toonflow/model-icons";
import thinkingEffortSlider from "@/components/thinkingEffortSlider.vue";
import { customProviders, modelChoices, setModelThinkingLevel, settings, thinkingLevelForModel, thinkingLevelOptionsFor } from "@/stores/settings";

const selectedModel = defineModel<string>({ default: "" });
const props = withDefaults(defineProps<{ active?: boolean; disabled?: boolean }>(), { active: true, disabled: false });
const visible = ref(false);
const modelGroups = computed(() => customProviders.value.toSorted((left, right) => Number(right.id === "tfRouter") - Number(left.id === "tfRouter")));
const selectedModelChoice = computed(() => modelChoices.value.find(item => item.value === selectedModel.value));
const thinkingOptions = computed(() => thinkingLevelOptionsFor(selectedModelChoice.value?.thinkingLevels ?? []));
const thinkingLevel = computed(() => thinkingLevelForModel(selectedModelChoice.value));
const thinkingLabel = computed(() => thinkingOptions.value.find(item => item.value === thinkingLevel.value)?.label ?? "服务默认");
function setThinking(level: string) {
  if (!props.disabled && selectedModel.value) setModelThinkingLevel(selectedModel.value, level);
}
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
  .levelTip { margin: 0; line-height: 1.5; }
}
</style>
