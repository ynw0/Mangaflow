import conf from "conf";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from "@toonflow/file";
import { join, resolve } from "node:path";
import type { RemoteTeam } from "@/utils/teams";
import type { A2aSettings } from "@/agent/a2a/settings";
import type { desktopUpdateAttempt } from "@/types/desktop";
import type { MobileLinkConfig } from "@/utils/mobileLink";
import { normalizeNodeMenu, serializeNodeMenu } from "@/lib/nodeMenu";

const removedProviderIds = new Set(["tfrouter", "apimart", "metaso", "compshare"]);
const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../../../../data");
mkdirSync(dataDirectory, { recursive: true });
const configDirectory = realpathSync(dataDirectory);
process.env.TOONFLOW_DATA_DIR = configDirectory;

const config = new conf<{ settings: Record<string, unknown>; disabledSkills: string[]; toolConfigs: Record<string, Record<string, unknown>>; nodeConfigs: Record<string, Record<string, unknown>>; extConfigs: Record<string, Record<string, unknown>>; remoteConnections: Record<string, RemoteTeam>; a2a: A2aSettings; desktopUpdateAttempt: desktopUpdateAttempt; mobileLink: MobileLinkConfig }>({
  cwd: configDirectory,
  configName: "settings",
  configFileMode: 0o600,
  watch: true,
});

function dropOfficialProviders(settings: Record<string, unknown>) {
  let changed = false;
  if (Array.isArray(settings.customProviders)) {
    const next = settings.customProviders.filter(item => {
      const id = item && typeof item === "object" && "id" in item && typeof item.id === "string" ? item.id.toLowerCase() : "";
      return !removedProviderIds.has(id);
    });
    if (next.length !== settings.customProviders.length) {
      settings.customProviders = next;
      changed = true;
    }
  }
  const configs = settings.mediaProviderConfigs;
  if (configs && typeof configs === "object" && !Array.isArray(configs)) {
    const record = configs as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (removedProviderIds.has(key.toLowerCase())) {
        delete record[key];
        changed = true;
      }
    }
  }
  return changed;
}

export function removeLegacySettings(settings: Record<string, unknown>) {
  let changed = false;
  // ACT: 只清理已废弃字段，保留其他设置和插件配置。
  for (const [record, key] of [[settings, "developerConfirmed"], [settings.general, "systemPrompt"], [settings.stores, "toonflow.developer"]] as const) {
    if (record && typeof record === "object" && !Array.isArray(record) && Object.hasOwn(record, key)) {
      Reflect.deleteProperty(record, key);
      changed = true;
    }
  }
  return changed;
}

export function cleanNodeMenuSettings(settings: Record<string, unknown>) {
  const general = settings.general;
  if (!general || typeof general !== "object" || Array.isArray(general) || !Object.hasOwn(general, "nodeMenu")) return false;
  const record = general as Record<string, unknown>;
  const installedTypes = new Set<string>();
  try {
    // ACT: 仅扫描已安装文件名；禁用节点保留配置，菜单清理与同步存盘间不插入异步等待。
    for (const file of readdirSync(resolve(configDirectory, "nodes"), { withFileTypes: true })) {
      if (file.isFile() && /^[a-z][a-zA-Z0-9]*\.umd\.js$/.test(file.name)) installedTypes.add(`remote-${file.name.slice(0, -7)}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const nodeMenu = serializeNodeMenu(normalizeNodeMenu(record.nodeMenu), installedTypes);
  if (!nodeMenu.length) {
    delete record.nodeMenu;
    return true;
  }
  if (JSON.stringify(record.nodeMenu) === JSON.stringify(nodeMenu)) return false;
  record.nodeMenu = nodeMenu;
  return true;
}

const qwenImageBaseUrl = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
const qwenImageApiKey = "sk-sp-H.DEXPLX.Rmv4.MEYCIQDAOybJEvPg45QGqVFBLpQ7ZNinhk_xOP9igKI4-IfjPgIhANvsQYatHKFz5aO20EpF6-S9vt24KKYjFIn_kPa12oMy";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function installQwenImageProvider() {
  const destination = join(configDirectory, "providers", "qwenImage.ts");
  const source = [
    resolve(import.meta.dirname, "../../../../../packages/providers/src/media/qwenImage.ts"),
    resolve(import.meta.dirname, "../../../../packages/providers/src/media/qwenImage.ts"),
  ].find(path => existsSync(path));
  if (!source) return;
  if (existsSync(destination) && readFileSync(destination, "utf8").includes("icon:")) return;
  mkdirSync(join(configDirectory, "providers"), { recursive: true });
  copyFileSync(source, destination);
}

function removeOfficialProviders() {
  const directory = join(configDirectory, "providers");
  for (const name of ["tfRouter.ts", "apiMart.ts", "metaso.ts", "compshare.ts"]) {
    const path = join(directory, name);
    if (existsSync(path)) rmSync(path);
  }
}

installQwenImageProvider();
removeOfficialProviders();

const settings = config.get("settings", {});
if (removeLegacySettings(settings) || dropOfficialProviders(settings)) config.set("settings", settings);

const mediaProviderConfigs = record(settings.mediaProviderConfigs);
const qwenImageConfig = record(mediaProviderConfigs.qwenImage);
let qwenImageChanged = false;
if (typeof qwenImageConfig.apiKey !== "string" || !qwenImageConfig.apiKey.trim()) {
  qwenImageConfig.apiKey = qwenImageApiKey;
  qwenImageChanged = true;
}
if (typeof qwenImageConfig.baseUrl !== "string" || !qwenImageConfig.baseUrl.trim()) {
  qwenImageConfig.baseUrl = qwenImageBaseUrl;
  qwenImageChanged = true;
}
if (qwenImageChanged) {
  settings.mediaProviderConfigs = { ...mediaProviderConfigs, qwenImage: qwenImageConfig };
  config.set("settings", settings);
}


const videoModelDefaults = record(settings.videoModel);
let videoModelChanged = false;
if (typeof videoModelDefaults.baseUrl !== "string" || !videoModelDefaults.baseUrl.trim()) {
  videoModelDefaults.baseUrl = "https://api.apimart.ai/v1";
  videoModelChanged = true;
}
if (typeof videoModelDefaults.modelId !== "string" || !videoModelDefaults.modelId.trim()) {
  videoModelDefaults.modelId = "wan3.0-video";
  videoModelChanged = true;
}
if (typeof videoModelDefaults.apiKey !== "string") {
  videoModelDefaults.apiKey = "";
  videoModelChanged = true;
}
if (videoModelChanged) {
  settings.videoModel = videoModelDefaults;
  config.set("settings", settings);
}

const production = record(settings.production);
let productionChanged = false;
if (production.imageSource !== "qwen") {
  production.imageSource = "qwen";
  productionChanged = true;
}
if (typeof production.imageProviderId !== "string" || !production.imageProviderId.trim()) {
  production.imageProviderId = "qwenImage";
  productionChanged = true;
}
if (typeof production.imageModelId !== "string" || !production.imageModelId.trim()) {
  production.imageModelId = "qwen-image-3.0-pro";
  productionChanged = true;
}
if (production.videoProviderId !== "videoModel" && production.videoProviderId !== "comfyui") {
  production.videoProviderId = "comfyui";
  productionChanged = true;
}
if (production.videoHost !== "local" && production.videoHost !== "autodl") {
  production.videoHost = "autodl";
  productionChanged = true;
}
if (production.videoHost === "local" && (typeof production.localComfyuiBaseUrl !== "string" || !production.localComfyuiBaseUrl.trim())) {
  production.localComfyuiBaseUrl = "http://127.0.0.1:8188";
  productionChanged = true;
}
if (productionChanged) {
  settings.production = production;
  config.set("settings", settings);
}

if (!config.has("settings.customProviders")) config.set("settings.customProviders", []);

export default config;
