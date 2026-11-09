<template>
  <el-popover v-model:visible="settingsVisible" trigger="click" placement="top-start" width="min(340px, calc(100vw - 24px))" :disabled="disabled" :showArrow="false" :popperStyle="{ padding: '14px' }">
    <template #reference>
      <el-button class="settingsButton" text size="small" :disabled="disabled" :aria-expanded="settingsVisible" aria-label="图片生成设置">
        <span class="ratioShape" :style="ratioStyle(ratio)" aria-hidden="true" />
        <span>{{ ratio }} · {{ size }} · 1张</span>
        <component :is="settingsVisible ? IconChevronDown : IconChevronUp" :size="14" aria-hidden="true" />
      </el-button>
    </template>
    <div class="generationSettings nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @wheel.stop>
      <div class="sectionLabel">分辨率</div>
      <el-radio-group v-model="size" class="sizeOptions" :disabled="disabled" aria-label="图片分辨率" @change="pickSize">
        <el-radio-button v-for="item in sizes" :key="item" :value="item">{{ item }}</el-radio-button>
      </el-radio-group>
      <div class="sectionLabel">比例</div>
      <div class="ratioOptions" role="group" aria-label="图片比例">
        <el-button
          v-for="item in ratios"
          :key="item"
          class="ratioButton"
          :disabled="disabled"
          :aria-label="`比例 ${item}`"
          :aria-pressed="ratio === item"
          @click="pickRatio(item)">
          <span class="ratioContent">
            <span class="ratioShape" :style="ratioStyle(item)" aria-hidden="true" />
            <span>{{ item }}</span>
          </span>
        </el-button>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ElButton, ElPopover, ElRadioGroup, ElRadioButton } from "element-plus";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";

const props = defineProps<{ sizes: string[]; ratios: string[]; disabled?: boolean }>();
const settingsVisible = ref(false);
const size = defineModel<string>("size", { required: true });
const ratio = defineModel<string>("ratio", { required: true });

function matchSize(value: string) {
  const [width, height] = value.split(":").map(Number);
  if (!width || !height) return;
  const target = width / height;
  return props.sizes.find(item => {
    const pair = /^(\d+)x(\d+)$/i.exec(item);
    if (!pair) return false;
    const actual = Number(pair[1]) / Number(pair[2]);
    return Math.abs(actual - target) / target < 0.03;
  });
}

function matchRatio(value: string) {
  const pair = /^(\d+)x(\d+)$/i.exec(value);
  if (!pair) return;
  const actual = Number(pair[1]) / Number(pair[2]);
  let best: { ratio: string; delta: number } | undefined;
  for (const item of props.ratios) {
    const [width, height] = item.split(":").map(Number);
    if (!width || !height) continue;
    const delta = Math.abs(actual - width / height);
    if (!best || delta < best.delta) best = { ratio: item, delta };
  }
  return best && best.delta / actual < 0.03 ? best.ratio : undefined;
}

function pickRatio(value: string) {
  ratio.value = value;
  const next = matchSize(value);
  if (next) size.value = next;
}

function pickSize() {
  // change 在 v-model 更新后触发，直接使用当前分辨率匹配比例。
  const next = matchRatio(size.value);
  if (next) ratio.value = next;
}

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

  .sizeOptions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
    .el-radio-button {
      flex: 1 1 calc(33.33% - 8px);
      --el-radio-button-checked-bg-color: var(--el-fill-color);
      --el-radio-button-checked-text-color: var(--el-text-color-primary);
      --el-radio-button-checked-border-color: var(--el-text-color-regular);

      :deep(.el-radio-button__inner) {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--el-border-color);
        border-radius: var(--el-border-radius-base);
        box-shadow: none;

        &:hover { color: var(--el-text-color-primary); }
      }

      &.is-active :deep(.el-radio-button__inner) {
        border-color: var(--el-text-color-regular);
      }
    }
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
}
</style>
