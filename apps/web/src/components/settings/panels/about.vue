<template>
  <div class="about">
    <div class="brand">
      <div class="brandMark"><img class="brandLogo" :src="logoUrl" alt="MangaFlow" /></div>
      <div class="brandInfo">
        <h3>MangaFlow</h3>
        <div v-if="currentVersion" class="brandMeta">
          <span>v{{ currentVersion }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import logoUrl from "@toonflow/assets/logo.svg";

const currentVersion = import.meta.env.appVersion;
</script>

<style lang="scss" scoped>
.about {
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 0 12px;

    .brandMark {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 60px;
      height: 60px;
      border-radius: calc(var(--ui-radius) * 1.5);
      background: var(--el-fill-color-light);

      .brandLogo {
        width: 42px;
        height: 42px;
        object-fit: contain;

        .dark & {
          filter: invert(1);
        }
      }
    }

    .brandInfo {
      min-width: 0;

      h3 {
        margin: 0 0 8px;
        color: var(--el-text-color-primary);
        font-size: 20px;
        font-weight: 600;
      }

      .brandMeta {
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }
    }
  }
}
</style>
