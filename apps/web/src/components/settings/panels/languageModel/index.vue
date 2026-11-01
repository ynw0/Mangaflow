<template>
  <div class="providerList">
    <section class="thinkingLevel" aria-labelledby="thinkingLevelTitle">
      <h3 id="thinkingLevelTitle">思考等级</h3>
      <p>对话使用这里的思考等级。模型不支持所选档位时，按它实际支持的最近档位发送。关闭思考后不再输出思考过程。</p>
      <el-segmented v-model="thinkingLevel" :options="thinkingLevelOptions" block aria-label="思考等级" />
    </section>
    <div class="itemList">
      <el-card v-for="item in sortedProviders" :key="item.id" class="providerItem" shadow="never">
        <div class="providerHeader">
          <div v-if="item.icon || isTfRouterProvider(item)" class="providerMark" aria-hidden="true">
            <img class="providerLogo" :class="{ monochrome: isTfRouterProvider(item) }" :src="item.icon || logoUrl" alt="" />
          </div>
          <div class="providerInfo">
            <div class="providerHeading">
              <el-text class="providerName" tag="strong">{{ item.label }}</el-text>
            </div>
            <el-text class="providerId" size="small" type="info" :title="item.id">{{ item.id }}</el-text>
          </div>
        </div>
        <tfAccount v-if="isTfRouterProvider(item)" :apiKey="typeof item.apiKey === 'string' ? item.apiKey : ''" :saveApiKey="(key) => saveProviderApiKey(item.id, key)" />
        <div class="providerFooter">
          <div class="providerMeta">
            <el-tag v-if="getProviderVersion(item)" size="small" type="info" effect="plain">v{{ getProviderVersion(item) }}</el-tag>
            <el-text size="small" type="info">{{ item.models.length }} 个模型</el-text>
          </div>
          <el-space class="itemActions" wrap>
            <el-button v-if="isTfRouterProvider(item) && item.apiKey?.trim() && !item.models.length" text :icon="IconRefresh" :loading="fetchingId === item.id" :disabled="!!deletingId || !!fetchingId" @click="fetchProviderModels(item)">获取模型</el-button>
            <el-button text :icon="IconEdit" :disabled="!!deletingId" @click="openCustomProvider(item)">编辑</el-button>
            <el-popconfirm title="确定删除此供应商及其模型？" confirmButtonText="删除" cancelButtonText="取消" @confirm="deleteProvider(item.id)">
              <template #reference><el-button text type="danger" :icon="IconTrash" :loading="deletingId === item.id" :disabled="!!deletingId">删除</el-button></template>
            </el-popconfirm>
          </el-space>
        </div>
      </el-card>
    </div>
    <div class="providerActions">
      <el-button class="addButton" :icon="IconPlus" @click="openProvider">添加供应商</el-button>
      <el-button class="addButton" :icon="IconSettings" @click="openCustomProvider()">添加自定义供应商</el-button>
    </div>
    <component :is="addProviderDialog" v-model="providerDialogVisible" />
    <component :is="addCustomProviderDialog" v-model="customProviderDialogVisible" :provider="editingProvider" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, type Component } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { customProviders, saveSettings, thinkingLevelOptions, thinkingLevelSetting, type CustomProvider, type ThinkingLevelChoice } from "@/stores/settings";
import { IconPlus, IconSettings, IconEdit, IconTrash, IconRefresh } from "@tabler/icons-vue";
import { languageProviders } from "@toonflow/providers";
import logoUrl from "@toonflow/assets/logo.svg";
import tfAccount from "../../tfAccount.vue";
import { isTfRouterProvider } from "@/lib/tf";

defineProps<{ visible?: boolean }>();
const addProviderDialog = shallowRef<Component>();
const addCustomProviderDialog = shallowRef<Component>();
const providerDialogVisible = ref(false);
const customProviderDialogVisible = ref(false);
const editingProvider = ref<CustomProvider>();
const deletingId = ref("");
const fetchingId = ref("");
const sortedProviders = computed(() => [...customProviders.value].sort((a, b) => Number(isTfRouterProvider(b)) - Number(isTfRouterProvider(a))));
const thinkingLevel = computed({
  get: () => thinkingLevelSetting.value,
  set: (value: ThinkingLevelChoice) => {
    void saveSettings(() => ({ thinkingLevel: value })).catch(() => ElMessage.error("保存思考等级失败，请重试"));
  },
});

function getProviderVersion(provider: CustomProvider) {
  const version = languageProviders.find(item => item.id.toLowerCase() === provider.id.toLowerCase())?.version ?? provider.version;
  return typeof version === "string" ? version.trim() : "";
}

function openProvider() {
  addProviderDialog.value ??= defineAsyncComponent(() => import("./addProviderDialog.vue"));
  providerDialogVisible.value = true;
}

function openCustomProvider(provider?: CustomProvider) {
  addCustomProviderDialog.value ??= defineAsyncComponent(() => import("./addCustomProviderDialog.vue"));
  editingProvider.value = provider;
  customProviderDialogVisible.value = true;
}

async function deleteProvider(id: string) {
  if (deletingId.value) return;
  deletingId.value = id;
  try {
    await saveSettings(settings => {
      const current = settings.customProviders;
      if (!Array.isArray(current)) throw new Error("配置格式错误");
      return { customProviders: current.filter(item => item?.id !== id) };
    });
  } catch { ElMessage.error("删除失败，请重试"); }
  finally { deletingId.value = ""; }
}

async function saveProviderApiKey(id: string, key: string) {
  const provider = customProviders.value.find(item => item.id === id);
  if (!provider) throw new Error("供应商已不存在");
  const { apiUrl, protocol, apiKey } = provider;
  await saveSettings(settings => {
    const current = settings.customProviders;
    if (!Array.isArray(current)) throw new Error("配置格式错误");
    const latest = current.find(item => item?.id === id);
    if (!latest) throw new Error("供应商已不存在");
    if (latest.apiUrl !== apiUrl || latest.protocol !== protocol || latest.apiKey !== apiKey) {
      throw new Error("供应商配置已变更，请重试");
    }
    return { customProviders: current.map(item => item?.id === id ? { ...item, apiKey: key } : item) };
  });
}

async function fetchProviderModels(provider: CustomProvider) {
  if (fetchingId.value) return;
  const { id, apiUrl, protocol, apiKey } = provider;
  fetchingId.value = id;
  try {
    const { data } = await axios.post("/api/providers/models", { apiUrl, protocol, apiKey }, { timeout: 35000 });
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "获取模型列表失败");
    if (!data.data.length) throw new Error("未获取到可用模型，请检查 API Key 后重试");
    await saveSettings(settings => {
      const current = settings.customProviders;
      if (!Array.isArray(current)) throw new Error("配置格式错误");
      const latest = current.find(item => item?.id === id);
      if (!latest) throw new Error("供应商已不存在");
      if (latest.apiUrl !== apiUrl || latest.protocol !== protocol || latest.apiKey !== apiKey) {
        throw new Error("供应商配置已变更，请重试");
      }
      const previous = new Map(provider.models.map(model => [model.id, model.inputs]));
      const models = data.data.map((model: { id?: string }) => {
        const inputs = typeof model.id === "string" ? previous.get(model.id) : undefined;
        return inputs ? { ...model, inputs } : model;
      });
      return { customProviders: current.map(item => item?.id === id ? { ...item, models } : item) };
    });
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || "获取模型列表失败，请重试" : error instanceof Error ? error.message : "获取模型列表失败，请重试");
  }
  finally { fetchingId.value = ""; }
}
</script>

<style lang="scss" scoped src="../../providerList.scss"></style>
<style lang="scss" scoped>
.thinkingLevel {
  margin-bottom: 16px;

  h3 {
    margin: 0 0 6px;
    font-size: 14px;
  }

  p {
    margin: 0 0 10px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
}
</style>
