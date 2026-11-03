// 内置技能按内容哈希升级：与上次下发一致就覆盖，用户改过则记下待合并版本。
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { cp, lstat, readFile, readdir, rename, rm, unlink, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

const markerNames = new Set([".builtinHash", ".builtinPending"]);

async function hashTree(directory: string) {
  const hash = createHash("sha256");
  let blocked = false;
  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (markerNames.has(entry.name)) continue;
      const path = resolve(current, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        blocked = true;
        return;
      }
      hash.update(relative(directory, path).replaceAll("\\", "/")).update("\0");
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) hash.update(await readFile(path)).update("\0");
      else blocked = true;
      if (blocked) return;
    }
  }
  await walk(directory);
  return blocked ? null : hash.digest("hex");
}

function versionParts(version: string) {
  if (!/^\d+(?:\.\d+)*$/.test(version)) return null;
  return version.split(".").map(part => Number(part));
}

// 没有 .builtinHash 的旧内置无法区分「上次下发」和「用户改过」。源版本号更高时整目录替换；同版本内容不同仍只记待合并。
function sourceVersionNewer(source: string, installed: string) {
  const left = versionParts(source);
  const right = versionParts(installed);
  if (!left || !right) return false;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const sourcePart = left[index] ?? 0;
    const installedPart = right[index] ?? 0;
    if (sourcePart !== installedPart) return sourcePart > installedPart;
  }
  return false;
}

async function skillVersion(directory: string) {
  const text = await readFile(resolve(directory, "SKILL.md"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (!text) return "";
  const { frontmatter } = parseFrontmatter(text);
  const metadata = frontmatter.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const version = (metadata as { version?: unknown }).version;
  return typeof version === "string" ? version.trim() : "";
}

async function removeFile(path: string) {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function replaceSkill(source: string, target: string) {
  const parent = resolve(target, "..");
  const temporary = resolve(parent, `.skillSync${crypto.randomUUID()}`);
  const backup = resolve(parent, `.skillBackup${crypto.randomUUID()}`);
  await cp(source, temporary, { recursive: true });
  try {
    await rename(target, backup);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rename(backup, target).catch(() => {});
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

export default async function syncBuiltinSkills(targetDirectory: string, sourceDirectory: string) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entries) return;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = resolve(sourceDirectory, entry.name);
    const target = resolve(targetDirectory, entry.name);
    const exists = await lstat(target).then(stat => stat.isDirectory()).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    if (!exists) continue;
    const sourceHash = await hashTree(source);
    const installedHash = await hashTree(target);
    const version = await skillVersion(source);
    const hashPath = resolve(target, ".builtinHash");
    const pendingPath = resolve(target, ".builtinPending");
    if (!sourceHash || !installedHash) {
      if (version) await writeAtomic(pendingPath, version);
      continue;
    }
    const recorded = await readFile(hashPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (recorded === null && sourceVersionNewer(version, await skillVersion(target))) {
      await replaceSkill(source, target);
      await writeAtomic(hashPath, sourceHash);
      await removeFile(pendingPath);
      continue;
    }
    const unchanged = recorded === null ? installedHash === sourceHash : installedHash === recorded.trim();
    if (unchanged && installedHash !== sourceHash) {
      await replaceSkill(source, target);
      await writeAtomic(hashPath, sourceHash);
      await removeFile(pendingPath);
      continue;
    }
    if (installedHash === sourceHash) {
      await writeAtomic(hashPath, sourceHash);
      await removeFile(pendingPath);
      continue;
    }
    if (version) await writeAtomic(pendingPath, version);
  }
}
