<template>
  <details class="catalog">
    <summary>
      <span>{{ title }}</span>
      <span class="count">启用 {{ enabledCount }} / {{ items.length }}</span>
    </summary>
    <ul v-if="items.length">
      <li v-for="item in items" :key="item.id">
        <span class="workflowInfo">
          <strong>{{ item.label }}</strong>
          <code>{{ item.id }}</code>
          <span v-if="item.usage" class="workflowUsage">{{ item.usage }}</span>
        </span>
        <el-switch :key="`${item.id}-${switchKey}`" :modelValue="!disabledIds.includes(item.id)" :aria-label="`${item.label}开关`" @update:modelValue="emit('change', item.id, $event)" />
      </li>
    </ul>
    <p v-else>暂无工作流</p>
  </details>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  title: string;
  items: { id: string; label: string; usage?: string }[];
  disabledIds: string[];
  switchKey: number;
}>();
const emit = defineEmits<{ change: [id: string, enabled: unknown] }>();

// 与列表中的开关共用禁用集合，计数直接反映当前配置。
const enabledCount = computed(() => props.items.filter(item => !props.disabledIds.includes(item.id)).length);
</script>

<style lang="scss" scoped>
.catalog {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);

  summary {
    padding: 10px 12px;
    cursor: pointer;
    color: var(--el-text-color-regular);
    font-size: 13px;
    font-weight: 600;

    .count {
      float: inline-end;
      margin-inline-start: 8px;
      color: var(--el-text-color-secondary);
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 12px;
      border-top: 1px solid var(--el-border-color-lighter);

      .workflowInfo {
        display: grid;
        gap: 3px;
        min-width: 0;
        overflow-wrap: anywhere;

        strong {
          color: var(--el-text-color-primary);
          font-size: 13px;
          font-weight: 550;
        }

        code {
          color: var(--el-text-color-secondary);
          font-size: 11px;
        }

        .workflowUsage {
          color: var(--el-text-color-regular);
          font-size: 12px;
          line-height: 1.5;
        }
      }
    }
  }

  p {
    margin: 0;
    padding: 6px 12px 12px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
}
</style>
