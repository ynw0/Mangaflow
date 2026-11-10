<template>
  <div class="agentProfiles">
    <div class="intro">
      <div>
        <h3>Agent 模型与推理配置</h3>
        <p>每种职责独立配置。模型与思考等级从已添加的文本模型中选择，修改后保存到应用设置，下一次子任务开始时生效。</p>
      </div>
      <el-tag type="info" effect="plain" round>按职责分配</el-tag>
    </div>

    <section class="profileSection" aria-label="主 Agent 模型">
      <div class="sectionTitle"><h4>主 Agent</h4><span>新对话默认配置</span></div>
      <div class="profileCard">
        <div class="roleTitle"><span class="roleIcon">主</span><div><strong>总控 Agent</strong><p>规划、画布调度和任务交接；已打开的会话保留自己的模型。</p></div></div>
        <div class="fieldGrid">
          <div class="field"><label>默认模型</label>
            <el-select v-model="mainModelKey" filterable placeholder="选择文本模型" aria-label="主 Agent 默认模型">
              <el-option v-for="item in modelOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </div>
          <div class="field"><label>思考等级</label>
            <div class="levelChips" role="group" aria-label="主 Agent 思考等级">
              <button v-for="choice in mainThinkingOptions" :key="choice.value" type="button"
                :class="{ selected: mainThinking === choice.value }" :aria-pressed="mainThinking === choice.value"
                :title="choice.value" @click="changeMainThinking(choice.value)">{{ choice.label }}</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="profileSection" aria-label="专业子 Agent">
      <div class="sectionTitle"><h4>专业子 Agent</h4><span>每个角色分别设置模型与思考强度</span></div>
      <div class="roleGrid">
        <div v-for="role in roles" :key="role.id" class="profileCard">
          <div class="roleTitle">
            <span class="roleIcon" :class="role.id">{{ role.icon }}</span>
            <div><strong>{{ role.title }}</strong><p>{{ role.description }}</p></div>
          </div>
          <div class="fieldGrid">
            <div class="field">
              <label :for="`model-${role.id}`">执行模型</label>
              <el-select :id="`model-${role.id}`" :model-value="profile(role.id).modelKey ?? ''"
                filterable :placeholder="inheritModelLabel(role.id)"
                :aria-label="`${role.title} 执行模型`" @change="value => changeModel(role.id, String(value))">
                <el-option :label="inheritModelLabel(role.id)" value="" />
                <el-option v-for="item in modelOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </div>
            <div class="field">
              <label>思考等级 <span class="fieldHint">{{ resolvedModel(role.id)?.label ?? "未选择模型" }}</span></label>
              <div class="levelChips" role="group" :aria-label="`${role.title} 思考等级`">
                <button type="button" :class="{ selected: (profile(role.id).thinkingLevel ?? 'inherit') === 'inherit' }"
                  :aria-pressed="(profile(role.id).thinkingLevel ?? 'inherit') === 'inherit'"
                  @click="changeThinking(role.id, 'inherit')">{{ profile(role.id).modelKey ? "默认" : "继承" }}</button>
                <button v-for="choice in roleThinkingOptions(role.id)" :key="choice.value" type="button"
                  :class="{ selected: profile(role.id).thinkingLevel === choice.value }"
                  :aria-pressed="profile(role.id).thinkingLevel === choice.value" :title="choice.value"
                  @click="changeThinking(role.id, choice.value)">{{ choice.label }}</button>
              </div>
            </div>
          </div>
          <p v-if="!resolvedModel(role.id)?.thinkingLevels?.length" class="capabilityNote">当前模型未检测到可配置的思考档位，只使用服务默认；可在模型选择处探测支持档位。</p>
        </div>
      </div>
    </section>
    <p class="footerTip">提示：普通委派与编剧、角色、场景、道具资源 Agent 使用各自配置；本地团队使用团队配置；视频导演与审核员分别使用独立配置。云端 A2A 团队由远端自行管理模型。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { customProviders, modelChoices, settings, setModelThinkingLevel, thinkingLevelForModel, thinkingLevelOptionsFor } from "@/stores/settings";

const roles = [
  { id: "subAgent", title: "通用 SubAgent", icon: "子", description: "普通委派任务的默认模型，供资源专职继承" },
  { id: "story", title: "编剧 Agent", icon: "编", description: "剧情改编、对白、场次和结构" },
  { id: "character", title: "角色 Agent", icon: "角", description: "角色设计、外观与身份连续性" },
  { id: "scene", title: "场景 Agent", icon: "景", description: "场景设计、布局及光影" },
  { id: "prop", title: "道具 Agent", icon: "道", description: "道具外形、材质与状态" },
  { id: "team", title: "本地团队 Agent", icon: "团", description: "本地 Team 的成员协作任务" },
  { id: "videoDirector", title: "视频导演", icon: "导", description: "H3 提示词编写及必要返修" },
  { id: "videoReviewer", title: "提示词审核", icon: "审", description: "独立核对剧情、镜头及参考一致性" },
] as const;
type Role = (typeof roles)[number]["id"];
type Profile = { modelKey?: string; thinkingLevel?: string };
function savedProfiles(): Partial<Record<Role, Profile>> {
  const raw = settings.value.agentProfiles;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Partial<Record<Role, Profile>> : {};
}
function profile(role: Role): Profile { return savedProfiles()[role] ?? {}; }
function changeProfile(role: Role, patch: Partial<Profile>) {
  const previous = savedProfiles();
  settings.value = { ...settings.value, agentProfiles: { ...previous, [role]: { ...profile(role), ...patch } } };
}
const modelOptions = computed(() => {
  const labels = new Map(customProviders.value.map(p => [p.id, p.label]));
  return modelChoices.value.map(m => ({ value: m.value, label: `${labels.get(m.providerId) ?? m.providerId} / ${m.label}` }));
});
const mainModelKey = computed({
  get: () => typeof settings.value.chatModelKey === "string" ? settings.value.chatModelKey : modelChoices.value[0]?.value ?? "",
  set: value => { settings.value = { ...settings.value, chatModelKey: value }; },
});
const mainModel = computed(() => modelChoices.value.find(m => m.value === mainModelKey.value));
const mainThinking = computed(() => thinkingLevelForModel(mainModel.value));
const mainThinkingOptions = computed(() => thinkingLevelOptionsFor(mainModel.value?.thinkingLevels ?? []));
function changeMainThinking(level: string) { if (mainModelKey.value) setModelThinkingLevel(mainModelKey.value, level); }
function inheritModelLabel(role: Role) {
  return ["story", "character", "scene", "prop", "team"].includes(role) ? "跟随通用 SubAgent" : "跟随主 Agent";
}
function resolvedModel(role: Role) {
  const own = profile(role).modelKey;
  const general = profile("subAgent").modelKey;
  const key = own || (["story", "character", "scene", "prop", "team"].includes(role) ? general : "") || mainModelKey.value;
  return modelChoices.value.find(m => m.value === key);
}
function roleThinkingOptions(role: Role) {
  return thinkingLevelOptionsFor(resolvedModel(role)?.thinkingLevels ?? []);
}
function changeModel(role: Role, modelKey: string) {
  const old = resolvedModel(role);
  const next = modelChoices.value.find(m => m.value === modelKey);
  // 不把前一个模型不支持的档位带到新模型。
  const previous = profile(role).thinkingLevel;
  const thinkingLevel = !modelKey ? "inherit"
    : previous && previous !== "inherit" && (previous === "off" || next?.thinkingLevels.includes(previous)) ? previous : "off";
  if (old?.value === modelKey && profile(role).modelKey === modelKey && profile(role).thinkingLevel === thinkingLevel) return;
  changeProfile(role, { modelKey, thinkingLevel });
}
function changeThinking(role: Role, level: string) {
  if (level !== "inherit" && !roleThinkingOptions(role).some(option => option.value === level)) return;
  changeProfile(role, { thinkingLevel: level });
}
</script>

<style lang="scss" scoped>
.agentProfiles { display: flex; flex-direction: column; gap: 23px; color: var(--el-text-color-primary); }
.intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
  h3 { margin: 0 0 7px; font-size: 17px; font-weight: 650; }
  p { margin: 0; font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.7; max-width: 600px; }
  .el-tag { flex-shrink: 0; }
}
.profileSection { display: flex; flex-direction: column; gap: 12px; }
.sectionTitle { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  h4 { margin: 0; font-size: 14px; font-weight: 650; }
  span { color: var(--el-text-color-secondary); font-size: 11px; }
}
.roleGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.profileCard { display: flex; flex-direction: column; min-width: 0; gap: 14px; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 14px; background: var(--el-bg-color-overlay); }
.roleTitle { display: flex; align-items: center; gap: 10px; min-height: 38px;
  .roleIcon { display: flex; flex: 0 0 35px; align-items: center; justify-content: center; height: 35px; border-radius: 10px; background: var(--el-fill-color); color: var(--el-text-color-primary); font-weight: 650; font-size: 13px;
    &.videoDirector, &.videoReviewer { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
  }
  strong { font-size: 13px; }
  p { margin: 3px 0 0; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.45; }
}
.fieldGrid { display: grid; grid-template-columns: 1fr; gap: 13px; }
.field { display: flex; flex-direction: column; gap: 7px; min-width: 0;
  label { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; color: var(--el-text-color-regular); font-size: 12px; font-weight: 600; }
  .fieldHint { max-width: 56%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-secondary); font-weight: 400; font-size: 11px; }
  .el-select { width: 100%; }
}
.levelChips { display: flex; flex-wrap: wrap; gap: 6px;
  button { padding: 6px 10px; min-height: 31px; border: 1px solid var(--el-border-color); border-radius: 8px; background: var(--el-fill-color-blank); color: var(--el-text-color-regular); font: inherit; font-size: 11px; cursor: pointer;
    &:hover { border-color: var(--el-color-primary-light-5); background: var(--el-fill-color-light); }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    &.selected { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); font-weight: 650; }
  }
}
.capabilityNote { margin: -5px 0 0; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.5; }
.footerTip { margin: 0; padding: 12px 14px; border-radius: 10px; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; }
@media (max-width: 900px) { .roleGrid { grid-template-columns: 1fr; } .intro { flex-wrap: wrap; } }
</style>
