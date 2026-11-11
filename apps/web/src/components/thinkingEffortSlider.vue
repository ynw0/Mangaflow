<template>
  <div class="thinkingEffortSlider" :class="{ isDisabled: disabled }" :style="trackStyle">
    <div class="effortDisplay">
      <span class="effortName">{{ currentOption?.label ?? "服务默认" }}</span>
      <span class="effortValue">{{ currentOption?.value === "off" ? "DEFAULT" : currentOption?.value?.toUpperCase() }}</span>
    </div>
    <div class="effortTrackWrap">
      <div class="effortTrack" aria-hidden="true">
        <div class="effortTrackFill" />
        <span class="effortThumb" />
      </div>
      <input
        class="effortRange"
        type="range"
        :aria-label="ariaLabel"
        :aria-valuetext="currentOption?.label ?? '服务默认'"
        :min="0"
        :max="Math.max(options.length - 1, 0)"
        :step="1"
        :value="currentIndex"
        :disabled="disabled || options.length < 2"
        @input="onInput" />
    </div>
    <div class="effortMarks" aria-hidden="true">
      <span v-for="(option, index) in options" :key="option.value"
        :class="{ active: index === currentIndex }" :title="option.label">{{ option.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

type EffortOption = { label: string; value: string };
const props = withDefaults(defineProps<{
  options: EffortOption[];
  modelValue: string;
  disabled?: boolean;
  ariaLabel?: string;
}>(), { disabled: false, ariaLabel: "思考等级" });
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const currentIndex = computed(() => Math.max(0, props.options.findIndex(option => option.value === props.modelValue)));
const currentOption = computed(() => props.options[currentIndex.value]);
const trackStyle = computed(() => {
  const progress = props.options.length < 2 ? 0 : currentIndex.value / (props.options.length - 1);
  return {
    "--effort-progress": `${(progress * 100).toFixed(2)}%`,
    "--effort-saturation": `${(0.55 + progress * 1.25).toFixed(2)}`,
    "--effort-glow": `${(progress * 0.52).toFixed(2)}`,
  };
});
function onInput(event: Event) {
  const index = Number((event.target as HTMLInputElement).value);
  const option = props.options[index];
  if (!props.disabled && option && option.value !== props.modelValue) emit("update:modelValue", option.value);
}
</script>

<style scoped lang="scss">
.thinkingEffortSlider {
  width: 100%;
  min-width: 0;
  padding: 12px 13px 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 13px;
  background: var(--el-fill-color-extra-light);
  transition: border-color 200ms ease, background 200ms ease;
  &.isDisabled { opacity: .58; }
}
.effortDisplay {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 12px;
  .effortName { font-size: 13px; font-weight: 650; color: var(--el-text-color-primary); }
  .effortValue { font-size: 10px; font-weight: 650; letter-spacing: .07em; color: var(--el-text-color-secondary); }
}
.effortTrackWrap { position: relative; height: 22px; display: flex; align-items: center; }
.effortTrack {
  position: relative; width: 100%; height: 8px; border-radius: 99px; background: var(--el-fill-color-dark);
  .effortTrackFill {
    width: var(--effort-progress); height: 100%; border-radius: inherit;
    background: linear-gradient(90deg, #8096af 0%, #4a9be9 22%, #6e62e7 43%, #c55df4 67%, #fa5eaa 83%, #ffc35b 100%);
    background-size: max(220px, 100%) 100%;
    filter: saturate(var(--effort-saturation));
    box-shadow: 0 0 13px rgba(163, 88, 255, var(--effort-glow));
    transition: width 160ms ease, filter 160ms ease, box-shadow 160ms ease;
  }
  .effortThumb {
    position: absolute; left: var(--effort-progress); top: 50%; transform: translate(-50%, -50%);
    width: 16px; height: 16px; border: 3px solid var(--el-bg-color-overlay); border-radius: 50%;
    background: #7b69f4; box-shadow: 0 1px 5px rgba(0,0,0,.2), 0 0 13px rgba(167, 94, 255, var(--effort-glow));
    transition: left 160ms ease;
  }
}
.effortRange {
  position: absolute; inset: 0; width: 100%; height: 22px; margin: 0; cursor: pointer; opacity: 0;
  &:disabled { cursor: not-allowed; }
  &:focus-visible + .effortFocus { outline: 2px solid var(--el-color-primary); }
}
.effortTrackWrap:focus-within .effortTrack { outline: 2px solid var(--el-color-primary); outline-offset: 4px; }
.effortMarks {
  display: flex; justify-content: space-between; gap: 2px; padding-top: 7px; overflow: hidden;
  span { min-width: 0; font-size: 10px; color: var(--el-text-color-placeholder); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; text-align: center; }
  span.active { color: var(--el-text-color-primary); font-weight: 650; }
}
</style>
