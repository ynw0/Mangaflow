<template>
  <el-popover v-model:visible="settingsVisible" trigger="click" placement="top-start" width="min(560px, calc(100vw - 24px))" :disabled="disabled" :showArrow="false" :popperStyle="{ padding: '14px' }"
    @show="emit('refreshComfyChoices')">
    <template #reference>
      <el-button class="settingsButton" text size="small" :disabled="disabled" :aria-expanded="settingsVisible" aria-label="视频生成设置">
        <span class="ratioShape" :style="ratioStyle(ratio)" aria-hidden="true" />
        <span>{{ summary }}</span>
        <component :is="settingsVisible ? IconChevronDown : IconChevronUp" :size="14" aria-hidden="true" />
      </el-button>
    </template>
    <div ref="settingsHost" class="generationSettingsHost nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @wheel.stop>
    <div class="generationSettings" tabindex="0" role="region" aria-label="视频生成参数（可上下滚动）">
      <div v-if="modes.length" class="sectionLabel">生成模式</div>
      <el-select v-if="modes.length" v-model="mode" :disabled="disabled" :append-to="settingsHost" aria-label="视频生成模式">
        <el-option v-for="item in modes" :key="item.value" :value="item.value" :label="item.label" />
      </el-select>
      <div v-if="durations.length || resolutions.length || sampling" class="outputOptions">
        <div v-if="durations.length" class="outputField">
          <div class="sectionLabel">时长</div>
          <el-select v-model="duration" :disabled="disabled" :append-to="settingsHost" aria-label="视频时长">
            <el-option v-for="item in durations" :key="item" :value="item" :label="`${item}秒`" />
          </el-select>
        </div>
        <div v-if="sampling" class="outputField">
          <div class="sectionLabel">百万像素</div>
          <el-select v-model="megapixels" :disabled="disabled" :append-to="settingsHost" aria-label="采样百万像素">
            <el-option v-for="item in megapixelOptions" :key="item.value" :value="item.value" :label="item.label" />
          </el-select>
        </div>
        <div v-else-if="resolutions.length" class="outputField">
          <div class="sectionLabel">分辨率</div>
          <el-select v-model="resolution" :disabled="disabled" :append-to="settingsHost" aria-label="视频分辨率">
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
      <div v-if="stepSpec" class="sizeHint" role="status">
        当前采样：一采 {{ firstPassSteps ?? stepSpec.firstPassDefault }} 步 + 二采 {{ secondPassSteps ?? stepSpec.secondPassDefault }} 步；手动通过下方预设切换，Agent 运行时可按已授权目标自定义。
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
        <template v-if="model.checkpoint">
          <div class="sectionLabel">使用模型</div>
          <el-select v-model="selectedCheckpoint" :disabled="disabled" :append-to="settingsHost" filterable aria-label="选择 H3 视频模型权重">
            <el-option :label="`默认 · ${model.checkpoint.defaultName.split(/[\\/]/).at(-1)}`" value="__workflow_checkpoint__" />
            <el-option v-for="name in checkpointOptions" :key="name" :value="name" :label="name" />
          </el-select>
        </template>
        <div class="sectionLabel">加速 LoRA（普通风格 LoRA 请放在附加列表）</div>
        <el-select v-model="selectedLora" :disabled="disabled" :append-to="settingsHost" filterable aria-label="选择 LoRA 或关闭">
          <el-option label="关闭加速 LoRA" value="__lora_disabled__" />
          <el-option v-for="name in loraOptions" :key="name" :value="name" :label="name" />
        </el-select>
        <el-button v-if="model.h3Advanced" size="small" text :disabled="disabled" @click="addingAccelerationLora = !addingAccelerationLora">不在列表中？手动添加加速 LoRA</el-button>
        <div v-if="addingAccelerationLora && model.h3Advanced" class="manualAccelerationPicker">
          <el-select :model-value="undefined" filterable :append-to="settingsHost" :disabled="disabled || loraLoading || !manualAccelerationCandidates.length"
            placeholder="从 ComfyUI 已安装 LoRA 选择" aria-label="手动标记加速 LoRA" @change="addManualAccelerationLora">
            <el-option v-for="name in manualAccelerationCandidates" :key="name" :label="name" :value="name" />
          </el-select>
          <div class="sizeHint">仅标记已有文件，不上传 LoRA。手动标记不保证 4/8 步、主模型和采样器兼容。PDD / PTD / HyperFlow 可能需要专用节点或调度器。</div>
          <div v-if="!loraLoading && !loraChoices?.length" class="sizeHint">尚未读取到已安装 LoRA，请先刷新列表。</div>
        </div>
        <div v-if="manualAccelerationLoras?.length && model.h3Advanced" class="manualAccelerationTags">
          <div class="sectionLabel">手动标记的加速 LoRA</div>
          <el-tag v-for="name in manualAccelerationLoras" :key="name" :closable="!disabled" :disable-transitions="true" :title="name" @close="removeManualAccelerationLora(name)">{{ name }}</el-tag>
        </div>
        <div v-if="manualAccelerationNotice" class="sizeHint" role="status">{{ manualAccelerationNotice }}</div>
        <el-button text size="small" :disabled="disabled || loraLoading" :loading="loraLoading" @click="emit('refreshComfyChoices')">{{ model.checkpoint ? '刷新模型与 LoRA' : '刷新 LoRA' }}</el-button>
        <div v-if="loraError" class="sizeHint" role="status">{{ loraError }}</div>
        <div v-if="model.h3Advanced" class="h3Advanced">
          <div class="sectionLabel">高级采样与附加 LoRA</div>
          <div v-if="selectedLora !== '__lora_disabled__'" class="h3AdvancedRow">
            <span>加速 LoRA 强度</span>
            <el-input-number :model-value="h3Options?.loraStrength ?? model.h3Advanced.loraStrength" :disabled="disabled" :min="0.01" :max="2" :step="0.05" :precision="2" controls-position="right" @update:model-value="value => patchAdvanced('loraStrength', value)" />
          </div>
          <div class="sectionLabel">附加 LoRA（从上往下加载，最多 3 个）</div>
          <div v-for="(item, index) in extraLoras" :key="index" class="h3LoraRow">
            <el-select :model-value="item.name" filterable :append-to="settingsHost" :disabled="disabled" aria-label="附加 LoRA" @change="value => updateExtra(index, {name:value})">
              <el-option v-for="name in availableExtraNames(index)" :key="name" :value="name" :label="name" />
            </el-select>
            <div class="h3AdvancedRow">
              <el-input-number :model-value="item.strength" :disabled="disabled" :min="0.01" :max="2" :step="0.05" :precision="2" controls-position="right" aria-label="附加 LoRA 强度" @update:model-value="value => {if (value !== undefined) updateExtra(index, {strength:value})}" />
              <el-button size="small" text :disabled="disabled || index===0" @click="moveExtra(index,-1)">上移</el-button>
              <el-button size="small" text :disabled="disabled || index===extraLoras.length-1" @click="moveExtra(index,1)">下移</el-button>
              <el-button size="small" text type="danger" :disabled="disabled" @click="removeExtra(index)">删除</el-button>
            </div>
          </div>
          <el-select v-if="extraLoras.length < model.h3Advanced.maxExtraLoras" :model-value="undefined" placeholder="添加已安装 LoRA" filterable :append-to="settingsHost" :disabled="disabled || !availableExtraNames(-1).length" @change="addExtra">
            <el-option v-for="name in availableExtraNames(-1)" :key="name" :value="name" :label="name"/>
          </el-select>
          <div class="sectionLabel">采样器</div>
          <el-select :model-value="h3Options?.sampler ?? '__workflow_default__'" filterable :append-to="settingsHost" :disabled="disabled" @change="value => patchAdvanced('sampler',value === '__workflow_default__' ? undefined : value)">
            <el-option :label="'默认 · '+model.h3Advanced.sampler" value="__workflow_default__"/>
            <el-option v-for="name in samplerOptions" :key="name" :value="name" :label="name"/>
          </el-select>
          <div class="sectionLabel">调度器</div>
          <el-select :model-value="h3Options?.scheduler ?? '__workflow_default__'" filterable :append-to="settingsHost" :disabled="disabled" @change="value => patchAdvanced('scheduler',value === '__workflow_default__' ? undefined : value)">
            <el-option :label="'默认 · '+model.h3Advanced.scheduler" value="__workflow_default__"/>
            <el-option v-for="name in schedulerOptions" :key="name" :value="name" :label="name"/>
          </el-select>
          <div class="h3AdvancedRow">
            <span>Video Shift</span>
            <el-input-number :model-value="h3Options?.videoShift ?? model.h3Advanced.videoShift" :disabled="disabled" :min="0.1" :max="30" :step="0.5" :precision="2" controls-position="right" @update:model-value="value => patchAdvanced('videoShift', value)"/>
          </div>
          <div class="h3AdvancedRow">
            <span>Audio Shift</span>
            <el-input-number :model-value="h3Options?.audioShift ?? model.h3Advanced.audioShift" :disabled="disabled" :min="0.1" :max="30" :step="0.5" :precision="2" controls-position="right" @update:model-value="value => patchAdvanced('audioShift', value)"/>
          </div>
          <div class="sizeHint" v-if="advancedError">{{ advancedError }}</div>
          <div class="sectionLabel">实验性采样预设（不换主模型）</div>
          <el-button size="small" :disabled="disabled || !presetPlans.normal.ok" @click="applyPreset('normal')">普通高质量 25步（20+5，Agent 可自定义25～40步）</el-button>
          <el-button size="small" :disabled="disabled || !presetPlans.preview4.ok" @click="applyPreset('preview4')">极速试镜 4步（2+2，LightX2V Ref2VA）</el-button>
          <el-button size="small" :disabled="disabled || !presetPlans.quick44.ok" @click="applyPreset('quick44')">快速 8步（4+4，加速 LoRA）</el-button>
          <el-button size="small" :disabled="disabled || !presetPlans.quick62.ok" @click="applyPreset('quick62')">快速 8步（6+2，加速 LoRA）</el-button>
          <el-button size="small" :disabled="disabled || !presetPlans.fused8.ok" @click="applyPreset('fused8')">已融合 Turbo 8步（4+4，仅关闭加速 LoRA）</el-button>
          <div class="sizeHint">试镜4步：仅快速验证构图/动作方向，不能直接当正式成片；8步4+4：普通剧情均衡；8步6+2：运动结构优先实验；25～40步：关键镜头高质量、关闭加速 LoRA；融合Turbo：仅已融合主模型使用，不额外叠加加速 LoRA。4+4/6+2优劣须实测。</div>
          <div class="sizeHint">智能自动选档在 设置 → 插件 → 已安装 → 技能 → h3SamplingStrategy 中启停；关闭后不向 Agent 提供配套工具，仍可手动使用本预设。</div>
          <div class="sizeHint">{{ presetHint }}</div>
          <div v-if="presetAvailabilityHint" class="sizeHint">{{ presetAvailabilityHint }}</div>
          <el-button text size="small" :disabled="disabled" @click="h3Options = undefined">恢复高级参数默认（不改模型/步数/加速 LoRA）</el-button>
          <div class="sizeHint">总步数 {{ (firstPassSteps ?? 0)+(secondPassSteps ?? 0) }}；一二采共用同一套采样序列。预设采用文件名识别及手动标记加速 LoRA；实际兼容性需验证。</div>
        </div>
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
      <div class="sectionLabel">成片质检</div>
      <el-select v-model="qcMode" :append-to="settingsHost" :disabled="disabled" aria-label="质检配置模式">
        <el-option value="inherit" label="继承系统设置" />
        <el-option value="off" label="关闭自动质检" />
        <el-option value="custom" label="自定义质检设置" />
      </el-select>
      <div v-if="qcMode === 'custom'" class="outputField">
        <div class="sectionLabel">质检方式</div>
        <el-select :model-value="customQc.qcMethod ?? props.qcDefaults?.qcMethod" :append-to="settingsHost" @change="value => patchQc({qcMethod:value})">
          <el-option value="model" label="专用质检模型" /><el-option value="agentFrames" label="主 Agent 抽帧" /><el-option value="agentFramesAndModel" label="联合质检" />
        </el-select>
        <div class="sectionLabel">质检范围</div>
        <el-select :model-value="customQc.qcLevel ?? props.qcDefaults?.qcLevel" :append-to="settingsHost" @change="value => patchQc({qcLevel:value})">
          <el-option value="video" label="仅画面" /><el-option value="videoAudio" label="画面 + 音轨" /><el-option value="none" label="关闭质检" />
        </el-select>
        <div class="sectionLabel">触发方式</div>
        <el-select :model-value="customQc.qcTrigger ?? props.qcDefaults?.qcTrigger" :append-to="settingsHost" @change="value => patchQc({qcTrigger:value})">
          <el-option value="auto" label="生成后自动" /><el-option value="manual" label="手动质检" />
        </el-select>
        <template v-if="(customQc.qcMethod ?? props.qcDefaults?.qcMethod) !== 'agentFrames' && (customQc.qcLevel ?? props.qcDefaults?.qcLevel) !== 'none'">
          <div class="sectionLabel">画面质检模型</div>
          <el-select :model-value="customQc.videoQcModelId ?? props.qcDefaults?.videoQcModelId" filterable :append-to="settingsHost" @change="selectVideoQc">
            <el-option v-for="item in props.qcChoices?.filter(item => item.video)" :key="item.id" :value="item.id" :label="item.label" />
          </el-select>
          <template v-if="(customQc.qcLevel ?? props.qcDefaults?.qcLevel) === 'videoAudio'">
            <div class="sectionLabel">音轨质检模型</div>
            <el-select :model-value="customQc.audioQcModelId ?? props.qcDefaults?.audioQcModelId" filterable :append-to="settingsHost" @change="selectAudioQc">
              <el-option v-for="item in props.qcChoices?.filter(item => item.audio)" :key="item.id" :value="item.id" :label="item.label" />
            </el-select>
          </template>
          <el-button text size="small" :loading="qcLoading" @click="emit('refreshQcChoices')">刷新已安装质检模型</el-button>
        </template>
      </div>
      <div class="sizeHint" v-if="qcError" role="status">{{ qcError }}</div>
      <div class="sizeHint" v-else>Gemma 运行位置继承系统设置，只有已启用的实际权重可选。</div>
      <template v-if="model?.supportsSeed">
        <div class="sectionLabel seedLabel">种子</div>
        <div class="seedRow">
          <el-select v-model="seedMode" class="seedModeSelect" :disabled="disabled" :append-to="settingsHost" aria-label="种子模式">
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
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton, ElPopover, ElSelect, ElOption, ElSwitch, ElInputNumber, ElTag } from "element-plus";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import type { H3Options, NodeMediaModel, NodeVideoRequest } from "@toonflow/nodes-scaffold/runtime";
import { createH3PresetPlan, isAccelerationLora, type H3SamplingPreset } from "./h3SamplingPresets";

const props = defineProps<{ model?: NodeMediaModel; disabled?: boolean; ratios: string[]; lastSeed?: number; loraChoices?: string[]; checkpointChoices?: string[]; samplerChoices?: string[]; schedulerChoices?: string[]; advancedError?: string; loraLoading?: boolean; loraError?: string; qcChoices?: {id:string;label:string;video:boolean;audio:boolean}[]; qcDefaults?: {qcMethod:string;qcLevel:string;qcTrigger:string;videoQcModelId:string;audioQcModelId:string;gemmaQcHost:string}; qcError?: string; qcLoading?: boolean }>();
const emit = defineEmits<{ refreshComfyChoices: []; refreshQcChoices: [] }>();
type CustomQc = Extract<NonNullable<NodeVideoRequest["qcOverride"]>, {mode:"custom"}>;
const qcOverride = defineModel<NodeVideoRequest["qcOverride"]>("qcOverride");
const qcMode = computed({ get: () => qcOverride.value?.mode ?? "inherit", set: (mode: string) => {
  qcOverride.value = mode === "off" ? {mode:"off"} : mode === "custom" ? {mode:"custom"} : undefined;
} });
const customQc = computed<CustomQc>(() => qcOverride.value?.mode === "custom" ? qcOverride.value : {mode:"custom"});
function patchQc(patch: Partial<CustomQc>) { qcOverride.value = {...customQc.value,...patch,mode:"custom"}; }
function selectVideoQc(id: string) { patchQc({videoQcModelId:id,...(id.startsWith("qc/gemma4:") ? {audioQcModelId:id} : {})}); }
function selectAudioQc(id: string) { patchQc({audioQcModelId:id,...(id.startsWith("qc/gemma4:") ? {videoQcModelId:id} : {})}); }
const settingsVisible = ref(false);
const settingsHost = ref<HTMLElement>();
const duration = defineModel<number | undefined>("duration", { required: true });
const resolution = defineModel<string>("resolution", { required: true });
const megapixels = defineModel<number | undefined>("megapixels");
const upscale = defineModel<number | undefined>("upscale");
const firstPassSteps = defineModel<number | undefined>("firstPassSteps");
const secondPassSteps = defineModel<number | undefined>("secondPassSteps");
const outputFirstPass = defineModel<boolean>("outputFirstPass", { required: true });
const loraName = defineModel<string | undefined>("loraName");
const checkpointName = defineModel<string | undefined>("checkpointName");
const h3Options = defineModel<H3Options | undefined>("h3Options");
const manualAccelerationLoras = defineModel<string[] | undefined>("manualAccelerationLoras");
const addingAccelerationLora = ref(false);
const manualAccelerationNotice = ref("");
const selectedCheckpoint = computed({
  get: () => checkpointName.value ?? "__workflow_checkpoint__",
  set: (value: string) => { checkpointName.value = value === "__workflow_checkpoint__" ? undefined : value; },
});
const checkpointOptions = computed(() => [...new Set([...(props.checkpointChoices ?? []), checkpointName.value])]
  .filter((name): name is string => !!name).sort((a, b) => a.localeCompare(b)));
const selectedLora = computed({
  get: () => loraName.value === "" ? "__lora_disabled__" : (loraName.value ?? props.model?.lora?.defaultName ?? ""),
  set: (value: string) => {
    if (value !== "__lora_disabled__" && extraLoras.value.some(item => normalized(item.name) === normalized(value))) { presetHint.value = "该 LoRA 已作为附加项，请先删除重复项。"; return; }
    loraName.value = value === "__lora_disabled__" ? "" : value;
    if (loraName.value === "") patchAdvanced("loraStrength",undefined);
  },
});
const loraOptions = computed(() => [...new Set([
  props.model?.lora?.defaultName,
  ...(props.loraChoices ?? []),
  loraName.value,
].filter((name): name is string => Boolean(name)))]
  .filter(name => isAccelerationLora(name, manualAccelerationLoras.value ?? []) || normalized(name) === normalized(selectedLora.value))
  .sort((a, b) => a.localeCompare(b)));
const presetHint = ref("预设仅改变采样参数和加速 LoRA；普通附加 LoRA 将保留。");
const normalized = (name: string) => name.replaceAll("\\","/");
const sameLora = (a: string, b: string) => normalized(a).toLowerCase() === normalized(b).toLowerCase();
const manualAccelerationCandidates = computed(() => (props.loraChoices ?? [])
  .filter(name => !isAccelerationLora(name, manualAccelerationLoras.value ?? []))
  .sort((a, b) => a.localeCompare(b)));
function addManualAccelerationLora(name: string) {
  if (props.disabled) return;
  const actual = (props.loraChoices ?? []).find(item => sameLora(item, name));
  if (!actual || isAccelerationLora(actual, manualAccelerationLoras.value ?? [])) {
    manualAccelerationNotice.value = "此文件不在已安装列表中，或已被识别为加速 LoRA；请刷新列表后重试。";
    return;
  }
  const current = manualAccelerationLoras.value ?? [];
  if (current.length >= 32) { manualAccelerationNotice.value = "最多允许手动标记 32 个加速 LoRA。"; return; }
  manualAccelerationLoras.value = [...current, actual];
  manualAccelerationNotice.value = "已加入加速 LoRA 候选列表。请在上方选择并核对采样兼容性。";
}
function removeManualAccelerationLora(name: string) {
  if (props.disabled) return;
  manualAccelerationLoras.value = (manualAccelerationLoras.value ?? []).filter(item => !sameLora(item, name));
  manualAccelerationNotice.value = "已取消手动加速标记，不会删除 ComfyUI 中的文件。";
}
const extraLoras = computed(() => h3Options.value?.extraLoras ?? []);
const samplerOptions = computed(() => [...new Set([...(props.samplerChoices ?? []),h3Options.value?.sampler])].filter((x):x is string => !!x));
const schedulerOptions = computed(() => [...new Set([...(props.schedulerChoices ?? []),h3Options.value?.scheduler])].filter((x):x is string => !!x));
function patchAdvanced<K extends keyof H3Options>(key: K, value: H3Options[K] | undefined) {
  if (!props.model?.h3Advanced) return;
  const next = {...h3Options.value};
  if (value === undefined) delete next[key]; else next[key] = value;
  h3Options.value = Object.keys(next).length ? next : undefined;
}
function availableExtraNames(index: number) {
  const selected = extraLoras.value[index]?.name;
  const primary = selectedLora.value;
  return [...new Set([...(props.loraChoices ?? []),selected])].filter((name):name is string => !!name)
    .filter(name => name === selected || (normalized(name) !== normalized(primary) && !extraLoras.value.some((item,i) => i!==index && normalized(item.name)===normalized(name))));
}
function updateExtra(index: number, patch: {name?:string;strength?:number}) {
  const item = extraLoras.value[index];
  if (!item || (patch.strength !== undefined && !Number.isFinite(patch.strength))) return;
  patchAdvanced("extraLoras",extraLoras.value.map((previous,i) => i===index ? {...previous,...patch} : previous));
}
function addExtra(name: string) {
  if (extraLoras.value.length >= (props.model?.h3Advanced?.maxExtraLoras ?? 0) || !availableExtraNames(-1).includes(name)) return;
  patchAdvanced("extraLoras",[...extraLoras.value,{name,strength:0.9}]);
}
function removeExtra(index: number) { const items=extraLoras.value.filter((_,i)=>i!==index); patchAdvanced("extraLoras",items.length ? items : undefined); }
function moveExtra(index:number, direction:number) {
  const items=[...extraLoras.value]; const other=index+direction;
  if (other<0 || other>=items.length || !items[index] || !items[other]) return;
  [items[index],items[other]]=[items[other]!,items[index]!]; patchAdvanced("extraLoras",items);
}
const isTurboCheckpoint = computed(() => /turbo/i.test(normalized(checkpointName.value ?? props.model?.checkpoint?.defaultName ?? "").split("/").at(-1) ?? ""));
const presetInput = computed(() => ({
  installedLoras: props.loraChoices ?? [],
  manualAccelerationLoras: manualAccelerationLoras.value ?? [],
  primaryLora: selectedLora.value === "__lora_disabled__" ? "" : selectedLora.value,
  primaryStrength: h3Options.value?.loraStrength ?? props.model?.h3Advanced?.loraStrength ?? 1,
  extraLoras: extraLoras.value,
  maxExtraLoras: props.model?.h3Advanced?.maxExtraLoras ?? 3,
  turboCheckpoint: isTurboCheckpoint.value,
  eulerAvailable: props.samplerChoices?.includes("euler") ?? false,
}));
const presetPlans = computed(() => ({
  normal: createH3PresetPlan("normal", presetInput.value),
  preview4: createH3PresetPlan("preview4", presetInput.value),
  quick44: createH3PresetPlan("quick44", presetInput.value),
  quick62: createH3PresetPlan("quick62", presetInput.value),
  fused8: createH3PresetPlan("fused8", presetInput.value),
}));
const presetAvailabilityHint = computed(() => {
  if (props.loraLoading || props.loraError || isTurboCheckpoint.value) return "";
  const quick = presetPlans.value.quick44;
  return quick.ok ? "" : quick.reason;
});
function applyPreset(preset: H3SamplingPreset) {
  if (!props.model?.h3Advanced) return;
  const plan = presetPlans.value[preset];
  if (!plan.ok) { presetHint.value = plan.reason; return; }
  loraName.value = plan.primaryLora;
  firstPassSteps.value = plan.firstPassSteps;
  secondPassSteps.value = plan.secondPassSteps;
  h3Options.value = {
    sampler: plan.sampler, scheduler: "simple", videoShift: 12, audioShift: 3,
    ...(plan.primaryStrength === undefined ? {} : { loraStrength: plan.primaryStrength }),
    ...(plan.extraLoras.length ? { extraLoras: plan.extraLoras } : {}),
  };
  presetHint.value = plan.hint;
}
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
    grid-template-columns: repeat(auto-fit, minmax(min(64px, 100%), 1fr));
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

.h3Advanced { display:flex; flex-direction:column; gap:7px; border-top:1px solid var(--el-border-color); margin-top:8px; padding-top:8px; }
.h3AdvancedRow { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-width: 0; }
.h3AdvancedRow :deep(.el-button + .el-button) { margin-left: 0; }
.h3Advanced > :deep(.el-button) {
  margin-left: 0;
  min-width: 0;
  max-width: 100%;
  height: auto;
  min-height: 24px;
  white-space: normal;
  line-height: 1.5;
  padding: 5px 9px;
  > span { min-width: 0; overflow-wrap: anywhere; }
}
.h3AdvancedRow .el-input-number { width:120px; flex-shrink:0; }
.h3LoraRow { display:flex; flex-direction:column; gap:4px; padding:5px; border:1px solid var(--el-border-color); border-radius:6px; }
.generationSettingsHost {
  position: relative;
  min-width: 0;
  :deep(.el-select-dropdown__item) {
    height: auto;
    min-height: 34px;
    line-height: 1.5;
    padding-top: 7px;
    padding-bottom: 7px;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
.generationSettings {
  max-height: min(65vh, 620px);
  max-height: min(65dvh, 620px);
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  box-sizing: border-box;
  overscroll-behavior-y: contain;
  :deep(.el-select) { min-width: 0; max-width: 100%; }
  .sizeHint, .sectionLabel { overflow-wrap: anywhere; }
  scrollbar-gutter: stable;
  padding-right: 6px;
  &:focus-visible { outline: 1px solid var(--el-color-primary); outline-offset: -1px; }
}
</style>
