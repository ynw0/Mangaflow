// 与 index.ts 一致：源码在 apps/server/src，构建产物在 build/server，按文件位置定位仓库根。
import { resolve } from "node:path";

export function resolveAppDirectory(metaDirname = import.meta.dirname, metaPath = import.meta.path) {
  const fromSource = metaPath.endsWith(".ts");
  return resolve(metaDirname, fromSource ? "../../.." : "../..");
}
