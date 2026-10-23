// 与 index.ts 一致：源码在 apps/server/src，构建产物在 build/server，按文件位置定位仓库根。
// 桌面打包入口在 Resources/app/bun，上一级为 app 根（与 skills/workflows 同级）。
import { resolve } from "node:path";

export function resolveAppDirectory(metaDirname = import.meta.dirname, metaPath = import.meta.path) {
  const fromSource = metaPath.endsWith(".ts");
  if (!fromSource && /[/\\]app[/\\]bun$/i.test(metaDirname)) {
    return resolve(metaDirname, "..");
  }
  return resolve(metaDirname, fromSource ? "../../.." : "../..");
}