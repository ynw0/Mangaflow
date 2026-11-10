<template>
  <el-popover v-model:visible="settingsVisible" trigger="click" placement="top-start" width="min(340px, calc(100vw - 24px))" :disabled="disabled" :showArrow="false" :popperStyle="{ padding: '14px' }">
    <template #reference>
      <el-button class="settingsButton" text size="small" :disabled="disabled" :aria-expanded="settingsVisible" aria-label="视频生成设置">
        <span class="ratioShape" :style="ratioStyle(ratio)" aria-hidden="true" />
        <span>{{ summary }}</span>
        <component :is="settingsVisible ? IconChevronDown : IconChevronUp" :size="14" aria-hidden="true" />
      </el-button>
    </template>
    <div class="generationSettings nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @wheel.stop>
      <div v-if="modes.length" class="sectionLabel">生成模式</div>
      <el-select v-if="modes.length" v-model="mode" :disabled="disabled" :teleported="false" aria-label="视频生成模式">
        <el-option v-for="item in modes" :key="item.value" :value="item.value" :label="item.label" />
      </el-select>
      <div v-if="durations.length || resolutions.length || sampling" class="outputOptions">
        <div v-if="durations.length" class="outputField">
          <div class="sectionLabel">时长</div>
          <el-select v-model="duration" :disabled="disabled" :teleported="false" aria-label="视频时长">
            <el-option v-for="item in durations" :key="item" :value="item" :label="`${item}秒`" />
          </el-select>
        </div>
        <div v-if="sampling" class="outputField">
          <div class="sectionLabel">百万像素</div>
          <el-select v-model="megapixels" :disabled="disabled" :teleported="false" aria-label="采样百万像素">
            <el-option v-for="item in megapixelOptions" :key="item.value" :value="item.value" :label="item.label" />
          </el-select>
        </div>
        <div v-else-if="resolutions.length" class="outputField">
          <div class="sectionLabel">分辨率</div>
          <el-select v-model="resolution" :disabled="disabled" :teleported="false" aria-label="视频分辨率">
            <el-option v-for="item in resolutions" :key="item" :value="item" :label="item" />
          </el-select>
        </div>
      </div>
      <div v-if="sampling" class="upscaleOption">
        <div class="sectionLabel">放大倍率</div>
        <el-input-number
          v-model="upscale"
          class="upscaleInput"
          :disabled="disabled"
          :min="sampling.upscaleMin"
          :max="sampling.upscaleMax"
          :step="sampling.upscaleStep"
          :precision="2"
          controlsPosition="right"
          aria-label="放大倍率" />
        <div v-if="outputSize" class="sizeHint">成片 {{ outputSize.width }}×{{ outputSize.height }}</div>
      </div>
      <div v-if="stepSpec" class="passSteps">
        <div class="outputField">
          <div class="sectionLabel">一采步数</div>
          <el-input-number
            v-model="firstPassSteps"
            class="stepInput"
            :disabled="disabled"
            :min="stepSpec.firstPassMin"
            :max="stepSpec.firstPassMax"
            :step="1"
            :precision="0"
            controlsPosition="right"
            aria-label="一采步数" />
        </div>
        <div class="outputField">
          <div class="sectionLabel">二采步数</div>
          <el-input-number
            v-model="secondPassSteps"
            class="stepInput"
            :disabled="disabled"
            :min="stepSpec.secondPassMin"
            :max="stepSpec.secondPassMax"
            :step="1"
            :precision="0"
            controlsPosition="right"
            aria-label="二采步数" />
        </div>
      </div>
      <div class="sectionLabel">通用比例</div>
      <div class="ratioOptions" role="group" aria-label="视频比例">
        <el-button v-for="item in ratios" :key="item" class="ratioButton" :disabled="disabled" :aria-label="`比例 ${item}`" :aria-pressed="ratio === item" @click="ratio = item">
          <span class="ratioContent">
            <span class="ratioShape" :style="ratioStyle(item)" aria-hidden="true" />
            <span>{{ item }}</span>
          </span>
        </el-button>
      </div>
      <div v-if="model?.lora" class="loraSelect">
        <div class="sectionLabel">使用 LoRA</div>
        <el-select v-model="selectedLora" :disabled="disabled" :teleported="false" filterable aria-label="选择 LoRA 或关闭">
          <el-option label="关闭 LoRA（基础模型）" value="" />
          <el-option v-for="name in loraOptions" :key="name" :value="name" :label="name" />
        </el-select>
        <el-button text size="small" :disabled="disabled || loraLoading" :loading="loraLoading" @click="emit('refreshLoras')">读取 ComfyUI 已安装 LoRA</el-button>
        <div v-if="loraError" class="sizeHint">{{ loraError }}</div>
        <div class="sizeHint">选择其他 LoRA 前请确认与 H3 基础模型兼容。</div>
      </div>
      <div v-if="model?.supportsFirstPassOutput" class="audioOption">
        <span class="sectionLabel">输出一采视频</span>
        <el-switch v-model="outputFirstPass" :disabled="disabled" aria-label="输出一采视频" />
      </div>
      <div v-if="model?.audio === 'optional'" class="audioOption">
        <span class="sectionLabel">生成音频</span>
        <el-switch v-model="generateAudio" :disabled="disabled" aria-label="生成音频" />
      </div>
      <template v-if="model?.supportsSeed">
        <div class="sectionLabel seedLabel">种子</div>
        <div class="seedRow">
          <el-select v-model="seedMode" class="seedModeSelect" :disabled="disabled" :teleported="false" aria-label="种子模式">
            <el-option value="fixed" label="固定" />
            <el-option value="random" label="随机" />
            <el-option value="last" label="固定上次随机" :disabled="lastSeed == null" />
          </el-select>
          <el-input-number
            v-model="displayedSeed"
            class="seedInput"
            :disabled="disabled || seedMode !== 'fixed'"
            :placeholder="seedMode === 'random' ? '生成时取值' : '暂无随机记录'"
            :controls="false"
            :min="0"
            :max="Number.MAX_SAFE_INTEGER"
            :step="1"
            :precision="0"
            aria-label="种子值" />
        </div>
      </template>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton, ElPopover, ElSelect, ElOption, ElSwitch, ElInputNumber } from "element-plus";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import type { NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";

const props = defineProps<{ model?: NodeMediaModel; disabled?: boolean; ratios: string[]; lastSeed?: number; loraChoices?: string[]; loraLoading?: boolean; loraError?: string }>();
const emit = defineEmits<{ refreshLoras: [] }>();
const settingsVisible = ref(false);
const duration = defineModel<number | undefined>("duration", { required: true });
const resolution = defineModel<string>("resolution", { required: true });
const megapixels = defineModel<number | undefined>("megapixels");
const upscale = defineModel<number | undefined>("upscale");
const firstPassSteps = defineModel<number | undefined>("firstPassSteps");
const secondPassSteps = defineModel<number | undefined>("secondPassSteps");
const outputFirstPass = defineModel<boolean>("outputFirstPass", { required: true });
const loraName = defineModel<string | undefined>("loraName");
const selectedLora = computed({
  get: () => loraName.value ?? props.model?.lora?.defaultName ?? "",
  set: (value: string) => { loraName.value = value; },
});
const loraOptions = computed(() => [...new Set([
  props.model?.lora?.defaultName,
  ...(props.loraChoices ?? []),
  loraName.value,
].filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b)));
const ratio = defineModel<string>("ratio", { required: true });
const mode = defineModel<string>("mode", { required: true });
const generateAudio = defineModel<boolean>("generateAudio", { required: true });
const seed = defineModel<number>("seed", { required: true });
const seedMode = defineModel<"fixed" | "random" | "last">("seedMode", { required: true });
const displayedSeed = computed({
  get: () => seedMode.value === "fixed" ? seed.value : props.lastSeed,
  set: value => { if (seedMode.value === "fixed" && value !== undefined) seed.value = value; },
});
const modeLabels: Record<string, string> = {
  text: "文生视频", singleImage: "单图参考", startEndRequired: "首尾帧必填", endFrameOptional: "尾帧可选", startFrameOptional: "首帧可选",
};
const modes = computed(() => (props.model?.mode ?? []).map(item => ({
  value: JSON.stringify(item),
  label: Array.isArray(item) ? "混合参考" : modeLabels[item] ?? item,
})));
const mappings = computed(() => props.model?.durationResolutionMap ?? []);
const durations = computed(() => [...new Set(mappings.value.flatMap(item => item.duration))].sort((a, b) => a - b));
const resolutions = computed(() => resolutionsFor(duration.value));

function resolutionsFor(value: number | undefined) {
  return [...new Set(mappings.value.filter(item => value !== undefined && item.duration.includes(value)).flatMap(item => item.resolution))];
}

const sampling = computed(() => props.model?.sampling);
const stepSpec = computed(() => {
  const value = sampling.value;
  if (!value || value.firstPassDefault == null || value.secondPassDefault == null || value.firstPassMin == null || value.firstPassMax == null || value.secondPassMin == null || value.secondPassMax == null) return;
  return value;
});
// 与 ComfyUI ResolutionSelector 一致：总像素 = 百万像素 × 1024²，再按倍数取整。
const aspectPairs: Record<string, [number, number]> = {
  "1:1": [1, 1], "2:3": [2, 3], "3:2": [3, 2], "3:4": [3, 4], "4:3": [4, 3], "9:16": [9, 16], "16:9": [16, 9], "21:9": [21, 9],
};

function roundHalfEven(value: number) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function selectorPixels(ratioValue: string, megapixelValue: number, multiple: number) {
  const pair = aspectPairs[ratioValue];
  if (!pair) return;
  const scale = Math.sqrt((megapixelValue * 1024 * 1024) / (pair[0] * pair[1]));
  return {
    width: roundHalfEven((pair[0] * scale) / multiple) * multiple,
    height: roundHalfEven((pair[1] * scale) / multiple) * multiple,
  };
}

function deliveredPixels(ratioValue: string, megapixelValue: number, scaleValue: number, multiple: number) {
  const base = selectorPixels(ratioValue, megapixelValue, multiple);
  if (!base) return;
  const align = (value: number, step: number) => roundHalfEven(value / step) * step;
  return {
    width: align(align(base.width * scaleValue, 32), 16),
    height: align(align(base.height * scaleValue, 32), 16),
  };
}

const megapixelOptions = computed(() => (sampling.value?.megapixels ?? []).map(value => {
  const size = sampling.value ? selectorPixels(ratio.value, value, sampling.value.multiple) : undefined;
  return { value, label: size ? `${value} · ${size.width}×${size.height}` : String(value) };
}));
const outputSize = computed(() => sampling.value && megapixels.value != null && upscale.value != null
  ? deliveredPixels(ratio.value, megapixels.value, upscale.value, sampling.value.multiple)
  : undefined);
const summary = computed(() => {
  const sizeText = sampling.value ? (outputSize.value ? `${outputSize.value.width}×${outputSize.value.height}` : "") : resolution.value;
  return [ratio.value, sizeText, duration.value ? `${duration.value}秒` : ""].filter(Boolean).join(" · ");
});

function ratioStyle(value: string) {
  const [width = 1, height = 1] = value.split(":").map(Number);
  return { width: `${16 * Math.min(width / height, 1)}px`, height: `${16 * Math.min(height / width, 1)}px` };
}
</script>

<style scoped lang="scss">
.ratioShape {
  display: inline-block;
  flex-shrink: 0;
  border: 1px solid currentColor;
  border-radius: 2px;
  box-sizing: border-box;
}

.settingsButton {
  flex-shrink: 0;
  :deep(> span) { gap: 6px; }
}

.generationSettings {
  text-align: left;

  .sectionLabel {
    margin-bottom: 8px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    font-weight: 500;
  }

  > .el-select { margin-bottom: 14px; }

  .outputOptions {
    display: flex;
    gap: 12px;
    margin-bottom: 14px;
    .outputField { flex: 1; min-width: 0; }
  }

  .upscaleOption {
    margin-bottom: 14px;

    .upscaleInput { width: 100%; }

    .sizeHint {
      margin-top: 6px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }
  }

  .passSteps {
    display: flex;
    gap: 12px;
    margin-bottom: 14px;

    .outputField { flex: 1; min-width: 0; }
    .stepInput { width: 100%; }
  }

  .ratioOptions {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;

    .ratioButton {
      height: 60px;
      margin: 0;
      padding: 8px 4px;
      color: var(--el-text-color-secondary);
      --el-button-bg-color: var(--el-fill-color-light);
      --el-button-hover-bg-color: var(--el-fill-color);
      --el-button-hover-text-color: var(--el-text-color-primary);
      --el-button-hover-border-color: var(--el-border-color-darker);

      &[aria-pressed="true"] {
        color: var(--el-text-color-primary);
        border-color: var(--el-text-color-regular);
        background: var(--el-fill-color);
      }

      .ratioContent {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }
    }
  }

  .audioOption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    .sectionLabel { margin: 0; }
  }

  .seedLabel { margin-top: 14px; }

  .seedRow {
    display: flex;
    gap: 8px;
    align-items: center;

    .seedModeSelect {
      width: 132px;
      flex-shrink: 0;
    }

    .seedInput {
      flex: 1;
      min-width: 0;
      :deep(.el-input__inner) { text-align: left; }
    }
  }
}
</style>
