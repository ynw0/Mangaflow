<template>
  <div class="modelPopover">
    <el-popover
      v-model:visible="visible"
      trigger="click"
      placement="top-start"
      :width="360"
      :offset="10"
      :showArrow="false"
      popperClass="agentModelPopover"
      :popperStyle="{ padding: '20px', maxWidth: 'calc(100vw - 24px)' }">
      <template #reference>
        <el-button class="modelButton" text :disabled="disabled" aria-label="选择模型">
          <modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.modelId" :size="14" />
          <span class="modelName">{{ selectedModelChoice?.label ?? "选择模型" }}</span>
          <component :is="visible ? IconChevronUp : IconChevronDown" :size="14" aria-hidden="true" />
        </el-button>
      </template>
      <el-form class="modelOptions" labelPosition="top">
        <el-form-item label="模型">
          <el-select v-model="selectedModel" filterable :disabled="disabled" :teleported="false" placeholder="选择模型" aria-label="选择模型" noDataText="请先在设置中添加模型">
            <template #prefix><modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.modelId" :size="18" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="model in provider.models" :key="model.id" :label="model.label" :value="JSON.stringify([provider.id, model.id])">
                <el-space :size="8">
                  <modelIcon :model="model.id" :size="16" />
                  <span>{{ model.label }}</span>
                </el-space>
              </el-option>
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item class="thinkingItem">
          <template #label>
            <span class="thinkingHead">
              <span>思考等级</span>
              <span class="thinkingCurrent">{{ thinkingLabel }}</span>
            </span>
          </template>
          <div
            ref="thinkingTrack"
            class="thinkingSlider"
            role="slider"
            :tabindex="disabled || !selectedModelChoice ? -1 : 0"
            :aria-disabled="disabled || !selectedModelChoice"
            aria-label="思考等级"
            aria-orientation="horizontal"
            :aria-valuemin="0"
            :aria-valuemax="Math.max(thinkingGears.length - 1, 0)"
            :aria-valuenow="thinkingIndex"
            :aria-valuetext="thinkingLabel"
            @pointerdown="dragThinking"
            @pointermove="moveThinking"
            @keydown="keyThinking">
            <span v-for="gear in thinkingGears" :key="gear.value" class="thinkingGear" :class="{ reached: gear.reached }" :style="{ '--gear': gear.color }" />
            <span class="thinkingThumb" :style="{ left: thumbLeft, '--thumb': thinkingGears[thinkingIndex]?.color }" />
          </div>
        </el-form-item>
      </el-form>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import { modelIcon } from "@toonflow/model-icons";
import { customProviders, modelChoices, setModelThinkingLevel, settings, thinkingLevelForModel, thinkingLevelOptionsFor } from "@/stores/settings";

const selectedModel = defineModel<string>({ default: "" });
const props = withDefaults(defineProps<{ active?: boolean; disabled?: boolean }>(), { active: true, disabled: false });
const visible = ref(false);
const modelGroups = computed(() => customProviders.value.toSorted((left, right) => Number(right.id === "tfRouter") - Number(left.id === "tfRouter")));
const selectedModelChoice = computed(() => modelChoices.value.find(item => item.value === selectedModel.value));
const thinkingTrack = ref<HTMLElement>();
const thinkingOptions = computed(() => thinkingLevelOptionsFor(selectedModelChoice.value?.thinkingLevels ?? []));
const thinkingLevel = computed({
  get: () => thinkingLevelForModel(selectedModelChoice.value),
  set: (value: string) => { if (selectedModel.value) setModelThinkingLevel(selectedModel.value, value); },
});
const thinkingIndex = computed(() => {
  const index = thinkingOptions.value.findIndex(item => item.value === thinkingLevel.value);
  return index < 0 ? 0 : index;
});
const thinkingLabel = computed(() => thinkingOptions.value[thinkingIndex.value]?.label ?? "关闭思考");
// 关闭思考是灰色。其余档位按从冷到暖铺开，模型和自定义档位都沿这条色带取色。
const thinkingGears = computed(() => {
  const colored = thinkingOptions.value.filter(item => item.value !== "off");
  return thinkingOptions.value.map((option, index) => {
    let color = "#c5cad3";
    if (option.value !== "off") {
      const place = Math.max(colored.findIndex(item => item.value === option.value), 0);
      const span = Math.max(colored.length - 1, 1);
      color = `hsl(${Math.round(214 - (place / span) * 214)} 76% 52%)`;
    }
    return { ...option, color, reached: index <= thinkingIndex.value };
  });
});
const thumbLeft = computed(() => {
  const count = Math.max(thinkingGears.value.length, 1);
  return `${((thinkingIndex.value + 0.5) / count) * 100}%`;
});

function pickThinking(index: number) {
  const option = thinkingOptions.value[index];
  if (!option || props.disabled || !selectedModel.value) return;
  thinkingLevel.value = option.value;
}

function indexFromPointer(event: PointerEvent) {
  const rect = thinkingTrack.value?.getBoundingClientRect();
  const count = thinkingOptions.value.length;
  if (!rect || rect.width <= 0 || count < 1) return 0;
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return Math.min(count - 1, Math.floor(ratio * count));
}

function dragThinking(event: PointerEvent) {
  if (props.disabled || !selectedModelChoice.value || event.button !== 0) return;
  thinkingTrack.value?.focus();
  pickThinking(indexFromPointer(event));
  thinkingTrack.value?.setPointerCapture(event.pointerId);
}

function moveThinking(event: PointerEvent) {
  if (!thinkingTrack.value?.hasPointerCapture(event.pointerId)) return;
  pickThinking(indexFromPointer(event));
}

function keyThinking(event: KeyboardEvent) {
  const last = thinkingOptions.value.length - 1;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); pickThinking(thinkingIndex.value + 1); }
  else if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); pickThinking(thinkingIndex.value - 1); }
  else if (event.key === "Home") { event.preventDefault(); pickThinking(0); }
  else if (event.key === "End") { event.preventDefault(); pickThinking(last); }
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

    > span {
      display: flex;
      gap: 6px;
      min-width: 0;
    }
    svg {
      flex-shrink: 0;
    }

    .modelName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }
  }
}

.agentModelPopover {
  .modelOptions {
    .el-form-item {
      margin-bottom: 24px;

      &:last-child {
        margin-bottom: 0;
      }
      .el-form-item__label {
        margin-bottom: 10px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
    }

    .thinkingItem .el-form-item__label {
      display: flex;
      width: 100%;
      padding-right: 0;
    }

    .thinkingHead {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
    }

    .thinkingCurrent {
      font-weight: 400;
      color: var(--el-text-color-secondary);
    }

    .thinkingSlider {
      position: relative;
      display: flex;
      width: 100%;
      height: 10px;
      border-radius: 999px;
      cursor: pointer;
      touch-action: none;
      outline: none;

      &:focus-visible {
        box-shadow: 0 0 0 3px var(--el-color-primary-light-8);
      }

      &[aria-disabled="true"] {
        cursor: not-allowed;
        opacity: 0.5;
      }
    }

    .thinkingGear {
      flex: 1;
      height: 100%;
      background: var(--gear);
      opacity: 0.38;

      &:first-child { border-radius: 999px 0 0 999px; }
      &:last-child { border-radius: 0 999px 999px 0; }
      &:only-child { border-radius: 999px; }

      &.reached { opacity: 1; }
    }

    .thinkingThumb {
      position: absolute;
      top: 50%;
      width: 18px;
      height: 18px;
      border: 2px solid var(--thumb, #8d93a0);
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 4px rgb(0 0 0 / 28%);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
  }
}
</style>
