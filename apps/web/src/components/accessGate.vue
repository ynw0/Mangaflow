<template>
  <form class="accessGate" @submit.prevent="submit">
    <div class="accessForm">
      <label class="accessLabel">
        访问令牌
        <el-input v-model="token" type="password" showPassword autocomplete="current-password" />
      </label>
      <el-button type="primary" nativeType="submit" :loading="pending">进入</el-button>
      <p v-if="message" class="accessError" role="alert">{{ message }}</p>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/button/style/css";

const token = ref("");
const pending = ref(false);
const message = ref("");

async function submit() {
  if (pending.value) return;
  pending.value = true;
  message.value = "";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.value.trim() }),
    });
    const body = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) throw new Error(body?.message || "访问令牌不正确");
    window.location.reload();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "访问令牌不正确";
    pending.value = false;
  }
}
</script>

<style scoped lang="scss">
.accessGate {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;

  .accessForm {
    width: min(100%, 360px);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .accessLabel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-weight: 600;
  }

  .accessError {
    margin: 0;
    color: var(--el-color-danger);
  }
}
</style>
